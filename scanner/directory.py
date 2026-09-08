"""Reverse ATS discovery. Ported from `scan-ats-full.mjs`.

Where the tracked path polls a curated company list, this walks *public directories of
every company per ATS* and finds companies that were never curated. Coverage has no
ceiling, which is exactly why the freshness gate in the reverse filter profile is
mandatory rather than optional.

**Security.** Company slugs here come from an untrusted external dataset, so two guards
sit in front of every constructed URL:

  - `SLUG_RE` gates the charset before interpolation, so nothing can inject path or
    query structure into the URL.
  - `entry_on_host` re-parses the *finished* URL and drops anything that doesn't
    resolve to the ATS's canonical host.

A tampered dataset can therefore at worst name boards that don't exist. Neither guard
is redundant; do not remove either.
"""
from __future__ import annotations

import json
import logging
import random
import time
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

import httpx

from scanner.providers._common import SLUG_RE
from scanner.registry import load_providers
from scanner.types import PortalEntry

logger = logging.getLogger(__name__)

CACHE_DIR = Path(".cache/ats-companies")
CACHE_TTL_SECONDS = 24 * 3600

# Tracks `main` deliberately: the dataset's value is freshness (new boards appear
# weekly), so pinning a commit defeats the purpose. Integrity rests on SLUG_RE +
# entry_on_host instead.
DATASET_BASE = (
    "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data"
)


def entry_on_host(
    name: str, careers_url: str, is_canonical_host: Callable[[str], bool]
) -> Optional[PortalEntry]:
    """Return the entry only if the constructed URL resolves to the expected host."""
    try:
        hostname = urlsplit(careers_url).hostname or ""
    except (ValueError, UnicodeError):
        return None
    if not is_canonical_host(hostname):
        return None
    return PortalEntry(name=name, careers_url=careers_url)


def _greenhouse_entry(slug: Any) -> Optional[PortalEntry]:
    slug = str(slug)
    if not SLUG_RE.match(slug):
        return None
    return entry_on_host(
        slug,
        f"https://job-boards.greenhouse.io/{slug}",
        lambda h: h == "job-boards.greenhouse.io",
    )


def _lever_entry(slug: Any) -> Optional[PortalEntry]:
    slug = str(slug)
    if not SLUG_RE.match(slug):
        return None
    return entry_on_host(
        slug, f"https://jobs.lever.co/{slug}", lambda h: h == "jobs.lever.co"
    )


def _ashby_entry(slug: Any) -> Optional[PortalEntry]:
    slug = str(slug)
    if not SLUG_RE.match(slug):
        return None
    return entry_on_host(
        slug, f"https://jobs.ashbyhq.com/{slug}", lambda h: h == "jobs.ashbyhq.com"
    )


def _workday_entry(line: Any) -> Optional[PortalEntry]:
    """Workday dataset entries are `tenant|instance|site` triples."""
    parts = str(line).split("|")
    if len(parts) != 3:
        return None
    tenant, instance, site = parts
    if not all(p and SLUG_RE.match(p) for p in (tenant, instance, site)):
        return None
    expected = f"{tenant}.{instance}.myworkdayjobs.com"
    return entry_on_host(
        tenant,
        f"https://{expected}/{site}",
        lambda h: h == expected and h.endswith(".myworkdayjobs.com"),
    )


SOURCES: dict[str, dict[str, Any]] = {
    "greenhouse": {
        "provider_id": "greenhouse",
        "dataset": f"{DATASET_BASE}/greenhouse_companies.json",
        "to_entry": _greenhouse_entry,
    },
    "lever": {
        "provider_id": "lever",
        "dataset": f"{DATASET_BASE}/lever_companies.json",
        "to_entry": _lever_entry,
    },
    "ashby": {
        "provider_id": "ashby",
        "dataset": f"{DATASET_BASE}/ashby_companies.json",
        "to_entry": _ashby_entry,
    },
    "workday": {
        "provider_id": "workday",
        "dataset": f"{DATASET_BASE}/workday_companies.json",
        "to_entry": _workday_entry,
    },
}


async def load_company_list(name: str, url: str) -> tuple[list, str]:
    """Fetch a company directory, cached 24h.

    Returns (list, status) where status is 'ok' (fresh or within TTL), 'stale' (fetch
    failed, serving an expired cache) or 'empty' (nothing at all). The status is what
    lets a caller distinguish a degraded scan from an empty one.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{name}.json"

    if cache_file.exists():
        age = time.time() - cache_file.stat().st_mtime
        if age < CACHE_TTL_SECONDS:
            try:
                return json.loads(cache_file.read_text()), "ok"
            except (json.JSONDecodeError, OSError):
                pass  # fall through and refetch

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
        if isinstance(data, list):
            cache_file.write_text(json.dumps(data))
            return data, "ok"
    except Exception as exc:  # noqa: BLE001 — degraded, not fatal
        logger.warning("%s: could not download company list — %s", name, exc)

    # A stale cache beats no data.
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text()), "stale"
        except (json.JSONDecodeError, OSError):
            pass
    return [], "empty"


def sample_companies(items: list, limit: Optional[int], shuffle: bool = False) -> list:
    """Cap the company list.

    Default is the dataset's natural (alphabetical) prefix. With `shuffle`, a random
    sample instead — otherwise a capped scan is permanently biased to the same
    alphabetical-first slice and later companies are never seen at all.
    """
    if not limit or limit >= len(items):
        return list(items)
    if not shuffle:
        return list(items[:limit])
    copy = list(items)
    random.shuffle(copy)
    return copy[:limit]


async def build_directory_entries(
    config: dict, skip: Optional[set[tuple[str, str]]] = None
) -> tuple[list[tuple[PortalEntry, Any]], dict]:
    """Resolve every configured ATS directory into (entry, provider) pairs.

    `skip` holds (provider_id, slug) pairs known to be dead. Filtering here rather
    than inside the fetch loop is the point: a skipped board costs no request at all.
    """
    providers = load_providers()
    requested = config.get("ats_sources") or list(SOURCES.keys())
    limit = config.get("limit_per_ats")
    shuffle = bool(config.get("shuffle"))

    pairs: list[tuple[PortalEntry, Any]] = []
    available = 0
    scanned = 0
    skipped = 0
    cap_hit = False
    dataset_status: dict[str, str] = {}

    for name in requested:
        source = SOURCES.get(name)
        if not source:
            logger.warning("unknown ATS source: %s", name)
            continue
        provider = providers.get(source["provider_id"])
        if provider is None:
            logger.warning("provider %s not loaded — skipping directory", source["provider_id"])
            continue

        items, status = await load_company_list(name, source["dataset"])
        dataset_status[name] = status
        available += len(items)
        if limit and limit < len(items):
            cap_hit = True

        for raw in sample_companies(items, limit, shuffle):
            entry = source["to_entry"](raw)
            if entry is None:
                continue
            if skip and (provider.id, entry.name) in skip:
                skipped += 1
                continue
            pairs.append((entry, provider))
            scanned += 1

    return pairs, {
        "available": available,
        "scanned": scanned,
        "skipped_dead": skipped,
        "cap_hit": cap_hit,
        "dataset_status": dataset_status,
    }
