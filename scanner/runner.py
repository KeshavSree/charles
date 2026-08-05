"""Scan orchestration.

One loop for every source. A source knows *where* postings come from. The runner owns
*what is kept*, via the `keep()` callback it hands each source.

That split is deliberate. If sources filtered themselves, the per-stage funnel would
fragment and each new source could silently drift in semantics, which is exactly how the
old `filters.py` became untrustworthy. It also keeps memory bounded: a full Greenhouse
directory sweep is 8,333 boards, and returning a list rather than streaming through
`keep()` would mean holding several hundred thousand postings before filtering.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from scanner.dedup import (
    build_company_canonicalizer,
    company_role_dedup_key,
    normalize_url_for_dedup,
)
from scanner.filters.chain import Counters, FilterChain
from scanner.fingerprint import fingerprint_text
from scanner.http import make_context
from scanner.types import Posting, ScanContext

logger = logging.getLogger(__name__)

DAY_MS = 86_400_000


@dataclass
class ScanResult:
    """Everything one source produced. Sources write their own metadata onto this."""

    counters: Counters = field(default_factory=Counters)
    postings: list[Posting] = field(default_factory=list)
    health: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    companies: int = 0
    companies_available: int = 0
    companies_scanned: int = 0
    cap_hit: bool = False
    dataset_status: dict[str, str] = field(default_factory=dict)
    unreachable_boards: int = 0
    workday_no_date_skip: int = 0

    def as_run_values(self) -> dict:
        values = self.counters.as_dict()
        values.pop("kept", None)
        values.update(
            {
                "companies": self.companies,
                "errors": len(self.errors),
                "companies_available": self.companies_available,
                "companies_scanned": self.companies_scanned,
                "cap_hit": self.cap_hit,
                "dataset_status": self.dataset_status or None,
                "unreachable_boards": self.unreachable_boards,
            }
        )
        return values


@dataclass
class SourceContext:
    """Handed to `Source.scan()`. The source reads config and writes to `result`.

    `keep` is the only way a posting reaches the database. It is intentionally
    synchronous: asyncio is single threaded and `keep` never awaits, so it is atomic
    with respect to a source's own concurrent workers and needs no lock.
    """

    config: dict
    settings: dict
    http: ScanContext
    keep: Callable[[Posting], bool]
    result: ScanResult
    session: Optional[AsyncSession] = None


def _make_keep(
    chain: FilterChain,
    result: ScanResult,
    source_id: str,
    seen_urls: set[str],
    seen_roles: set[str],
    canonicalize,
) -> Callable[[Posting], bool]:
    def keep(posting: Posting) -> bool:
        if not posting.url or not posting.title:
            return False
        posting.source_id = source_id

        if not chain.apply(posting, result.counters):
            return False

        # Intra-run dedup. Cross-run identity is the database's `dedup_url`.
        dedup_url = normalize_url_for_dedup(posting.url)
        if dedup_url in seen_urls:
            result.counters.dupes += 1
            result.counters.kept -= 1
            return False
        role_key = company_role_dedup_key(posting.company, posting.title, canonicalize)
        if role_key in seen_roles:
            result.counters.dupes += 1
            result.counters.kept -= 1
            return False
        seen_urls.add(dedup_url)
        seen_roles.add(role_key)

        posting.fingerprint = fingerprint_text(posting.description)
        result.postings.append(posting)
        return True

    return keep


# Every source is bounded by the same window, and 30 days is the ceiling as well as the
# default. Keeping it uniform means "how old can a posting be" has exactly one answer
# regardless of where the posting came from, and no source can ever be configured into
# an unbounded sweep.
MAX_POSTING_AGE_DAYS = 30


def resolve_age_days(config: dict) -> int:
    raw = config.get("max_posting_age_days")
    days = int(raw) if isinstance(raw, int) and raw > 0 else MAX_POSTING_AGE_DAYS
    return min(days, MAX_POSTING_AGE_DAYS)


def _cutoff_ms(config: dict) -> int:
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    return now_ms - resolve_age_days(config) * DAY_MS


async def run_source(
    source: Any,
    config: dict,
    *,
    settings: Optional[dict] = None,
    session: Optional[AsyncSession] = None,
    # Always on: the per-stage breakdown is how a run explains itself, and the
    # MAX_DROP_KEYS cap bounds the memory it can use.
    collect_samples: bool = True,
) -> ScanResult:
    """Run one source end to end and return everything it produced.

    Nothing is persisted here. The caller decides whether the result is written, which
    is what makes the preview endpoint a genuine dry run rather than a special case.
    """
    profile = getattr(source, "profile", "reverse")
    include_undated = bool(config.get("include_undated"))
    # Same window for every source, tracked or reverse.
    cutoff = _cutoff_ms(config)

    chain = FilterChain(
        config,
        profile=profile,
        cutoff_ms=cutoff,
        include_undated=include_undated,
        collect_samples=collect_samples,
    )
    result = ScanResult()
    canonicalize = build_company_canonicalizer(config.get("company_aliases"))
    keep = _make_keep(chain, result, source.id, set(), set(), canonicalize)

    async with httpx.AsyncClient() as client:
        http = make_context(client, since_ms=cutoff, include_undated=include_undated)
        sctx = SourceContext(
            config=config,
            settings=settings or {},
            http=http,
            keep=keep,
            result=result,
            session=session,
        )
        try:
            await source.scan(sctx)
        except Exception as exc:  # noqa: BLE001 — one source must not kill a run-all
            logger.exception("source %s failed", source.id)
            result.errors.append({"company": source.id, "error": str(exc), "kind": "source"})

    return result
