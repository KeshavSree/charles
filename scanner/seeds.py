"""VC portfolio seed sources. Ported from `seeds/vc-portfolios.mjs`.

A third discovery axis alongside tracked companies and ATS directories: start from a
VC's public portfolio list and probe each company for an ATS board. Catches early-stage
companies that are on nobody's curated list and may not yet appear in the ATS
directory dataset.

Workday is deliberately excluded from probing — its URLs need a tenant/instance/site
triple that cannot be derived from a portfolio slug.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

import httpx

from scanner.providers._common import SLUG_RE
from scanner.registry import load_providers
from scanner.types import PortalEntry

logger = logging.getLogger(__name__)

TIMEOUT_S = 20.0
USER_AGENT = "Mozilla/5.0 (compatible; charles-scanner-seeds/1.0)"

YC_API_URL = "https://api.ycombinator.com/v0.1/companies?page=1&per_page=1000"
A16Z_PORTFOLIO_URL = "https://a16z.com/portfolio/"

# Probe order. First provider whose detect() claims the URL wins.
SEED_PROVIDER_IDS = ("greenhouse", "lever", "ashby")


def parse_yc_payload(payload: Any) -> list[dict]:
    """Pure — no network — so the parse can be exercised with a captured fixture."""
    if not isinstance(payload, dict) and not isinstance(payload, list):
        return []
    items = payload.get("companies") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []

    seen: dict[str, dict] = {}
    for raw in items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        slug = str(raw.get("slug") or "").strip()
        if not name or not slug or not SLUG_RE.match(slug):
            continue
        seen.setdefault(slug, {
            "name": name,
            "slug": slug,
            "url": raw.get("website") or "",
            "source": "yc",
        })
    return list(seen.values())


_A16Z_LINK_RE = re.compile(
    r'<a[^>]+href="(?P<href>https?://[^"]+)"[^>]*>\s*(?P<name>[^<>]{2,80}?)\s*</a>', re.I
)


def parse_a16z_html(html: str) -> list[dict]:
    """Best-effort extraction of portfolio company names from the public page."""
    companies: dict[str, dict] = {}
    for match in _A16Z_LINK_RE.finditer(html or ""):
        name = match.group("name").strip()
        if not name or len(name) < 2:
            continue
        slug = re.sub(r"[^a-z0-9-]", "", name.lower().replace(" ", "-"))
        if not slug or not SLUG_RE.match(slug):
            continue
        companies.setdefault(slug, {
            "name": name,
            "slug": slug,
            "url": match.group("href"),
            "source": "a16z",
        })
    return list(companies.values())


def to_portal_entry(company: dict) -> PortalEntry:
    """Best-effort careers URL for a portfolio company.

    An explicit ATS hint wins. Otherwise guess a Greenhouse board from the slug — the
    most common choice for early-stage companies — and let detect() confirm or the
    fetch simply fail. Last resort is the company website.
    """
    careers_url = ""
    ats_id = company.get("ats_id")
    if ats_id and SLUG_RE.match(str(ats_id)):
        ats = company.get("ats")
        if ats == "greenhouse":
            careers_url = f"https://job-boards.greenhouse.io/{ats_id}"
        elif ats == "lever":
            careers_url = f"https://jobs.lever.co/{ats_id}"
        elif ats == "ashby":
            careers_url = f"https://jobs.ashbyhq.com/{ats_id}"

    if not careers_url:
        slug = company.get("slug")
        if slug and SLUG_RE.match(str(slug)):
            careers_url = f"https://job-boards.greenhouse.io/{slug}"

    if not careers_url:
        careers_url = company.get("url") or ""

    return PortalEntry(name=company.get("name") or "", careers_url=careers_url)


async def fetch_yc_companies() -> list[dict]:
    async with httpx.AsyncClient(timeout=TIMEOUT_S, headers={"user-agent": USER_AGENT}) as client:
        response = await client.get(YC_API_URL)
        response.raise_for_status()
        return parse_yc_payload(response.json())


async def fetch_a16z_companies() -> list[dict]:
    async with httpx.AsyncClient(
        timeout=TIMEOUT_S, headers={"user-agent": USER_AGENT}, follow_redirects=True
    ) as client:
        response = await client.get(A16Z_PORTFOLIO_URL)
        response.raise_for_status()
        return parse_a16z_html(response.text)


SEED_SOURCES = {
    "yc": {"fetch": fetch_yc_companies, "label": "Y Combinator Portfolio"},
    "a16z": {"fetch": fetch_a16z_companies, "label": "Andreessen Horowitz Portfolio"},
}


async def build_seed_entries(
    config: dict, seeds: list[str]
) -> tuple[list[tuple[PortalEntry, Any]], dict]:
    from scanner.registry import resolve_provider

    providers = load_providers()
    probe = {pid: providers[pid] for pid in SEED_PROVIDER_IDS if pid in providers}
    limit = config.get("limit_per_ats")

    pairs: list[tuple[PortalEntry, Any]] = []
    available = 0

    for seed_id in seeds:
        source = SEED_SOURCES.get(seed_id)
        if not source:
            logger.warning("unknown seed source: %s", seed_id)
            continue
        try:
            companies = await source["fetch"]()
        except Exception as exc:  # noqa: BLE001 — one bad source must not kill the run
            logger.warning("%s: could not fetch portfolio — %s", seed_id, exc)
            continue

        available += len(companies)
        if limit:
            companies = companies[:limit]

        for company in companies:
            entry = to_portal_entry(company)
            if not entry.careers_url:
                continue
            # A company with no detectable ATS is skipped silently — that is the
            # common case for a portfolio list, not an error worth reporting.
            for provider in probe.values():
                try:
                    if provider.detect(entry):
                        pairs.append((entry, provider))
                        break
                except Exception:  # noqa: BLE001
                    continue

    return pairs, {"available": available, "scanned": len(pairs)}
