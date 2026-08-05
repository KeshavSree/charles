"""Shared machinery for sources that feed companies through ATS providers.

`tracked`, `directory` and `seeds` all do the same thing once they have a list of
boards: fetch each one concurrently, classify any failure, and hand every posting to
`keep()`. Only *where the list comes from* differs, which is the whole point of the
source abstraction.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from scanner.errors import classify_fetch_error
from scanner.registry import load_providers, resolve_provider
from scanner.runner import SourceContext
from scanner.types import PortalEntry

logger = logging.getLogger(__name__)


def resolve_entries(
    entries: list[PortalEntry],
) -> tuple[list[tuple[PortalEntry, Any]], list[dict]]:
    """Pair each entry with the provider that claims its careers URL.

    An entry nothing claims is a configuration gap, not a fatal error, so it is
    reported rather than raised. That report is what surfaces as the red "none" in the
    Companies panel.
    """
    providers = load_providers()
    resolved: list[tuple[PortalEntry, Any]] = []
    unresolved: list[dict] = []
    for entry in entries:
        if not entry.enabled:
            continue
        provider, error = resolve_provider(entry, providers)
        if error:
            unresolved.append({"company": entry.name, "error": error})
        elif provider is None:
            unresolved.append({"company": entry.name, "error": "no provider matched"})
        else:
            resolved.append((entry, provider))
    return resolved, unresolved


async def scan_boards(
    sctx: SourceContext,
    pairs: list[tuple[PortalEntry, Any]],
    *,
    concurrency: Optional[int] = None,
    collect_health: bool = True,
) -> None:
    """Fetch every (entry, provider) pair and stream results through `keep()`.

    `collect_health` is off for directory and seed sweeps: thousands of rows per run
    would swamp the health table, and a defunct board in a public dataset is expected
    noise rather than a configuration problem worth alerting on.
    """
    limit = concurrency or sctx.config.get("concurrency") or 10
    semaphore = asyncio.Semaphore(max(1, int(limit)))
    result = sctx.result
    result.companies = len(pairs)

    async def worker(entry: PortalEntry, provider: Any) -> None:
        async with semaphore:
            try:
                postings = await provider.fetch(entry, sctx.http)
            except Exception as exc:  # noqa: BLE001 — classified into a health status
                kind = classify_fetch_error(exc)
                result.errors.append({"company": entry.name, "error": str(exc), "kind": kind})
                if collect_health:
                    result.health.append(
                        {"company": entry.name, "status": kind, "detail": str(exc)[:500]}
                    )
                result.unreachable_boards += 1
                return

        if getattr(postings, "workday_no_date_skip", False):
            result.workday_no_date_skip += 1
        if collect_health:
            result.health.append(
                {"company": entry.name, "status": "empty" if not postings else "reachable"}
            )

        for posting in postings:
            posting.provider_id = provider.id
            sctx.keep(posting)

    await asyncio.gather(*(worker(e, p) for e, p in pairs))
