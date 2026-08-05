"""Ashby — public posting-api endpoint.

Two behaviors here are load-bearing and were derived from live failures in career-ops:

1. **Timeout and retry.** Ashby's public posting-api has a ~10s server-side latency
   floor independent of board size, and rate-limits repeated unauthenticated hits. The
   global 10s default sits exactly on that floor, so requests race the timeout and
   abort. Hence a 30s timeout plus backoff-with-jitter retries — the backoff also
   spaces requests out to dodge the rate limiter.
2. **Secondary locations.** Extra hiring regions live in `secondaryLocations[]`. Using
   only `location` drops them, so an EU-eligible role whose *primary* label is
   "Canada" reads as Canada-only and gets wrongly removed by the location filter.
"""
from __future__ import annotations

import random
import re
from typing import Optional

from scanner.providers._common import assert_host, to_epoch_ms
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting, Salary, ScanContext

ALLOWED_HOSTS = {"api.ashbyhq.com"}
_TIMEOUT_S = 30.0
_RETRIES = 2

_BOARD_RE = re.compile(r"jobs\.ashbyhq\.com/([^/?#]+)")

# Annualization multipliers by compensation interval.
_INTERVAL_MULTIPLIERS = {
    "1 HOUR": 2080, "1 DAY": 260, "1 WEEK": 52, "2 WEEK": 26,
    "0.5 MONTH": 24, "1 MONTH": 12, "2 MONTH": 6, "3 MONTH": 4,
    "6 MONTH": 2, "1 YEAR": 1,
}


def _normalize_number(value: object) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def parse_compensation(job: dict) -> Optional[Salary]:
    """Annualize Ashby's compensation block, or None when there's nothing usable."""
    comp = job.get("compensation")
    if not isinstance(comp, dict):
        return None
    multiplier = _INTERVAL_MULTIPLIERS.get(comp.get("interval") or "1 YEAR")
    if not multiplier:
        return None

    low = _normalize_number(comp.get("minValue"))
    high = _normalize_number(comp.get("maxValue"))
    if low is None and high is None:
        return None

    annual_low = low * multiplier if low is not None else None
    annual_high = high * multiplier if high is not None else None
    resolved_low = annual_low if annual_low is not None else annual_high
    resolved_high = annual_high if annual_high is not None else annual_low
    currency = comp.get("currency")
    return Salary(
        min=min(resolved_low, resolved_high),
        max=max(resolved_low, resolved_high),
        currency=(currency or "").strip().upper() if isinstance(currency, str) else "",
    )


def format_location(job: dict) -> str:
    """Primary location folded together with every secondary hiring region."""
    parts: list[str] = []
    primary = job.get("location")
    if isinstance(primary, str) and primary.strip():
        parts.append(primary.strip())
    for secondary in job.get("secondaryLocations") or []:
        if not isinstance(secondary, dict):
            continue
        label = secondary.get("location")
        if isinstance(label, str) and label.strip():
            parts.append(label.strip())
        address = (secondary.get("address") or {}).get("postalAddress") or {}
        for key in ("addressLocality", "addressCountry"):
            value = address.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return " · ".join(dict.fromkeys(parts))


def _resolve_api_url(entry: PortalEntry) -> Optional[str]:
    if entry.api:
        assert_host(entry.api, ALLOWED_HOSTS, "ashby")
        return entry.api
    match = _BOARD_RE.search(entry.careers_url or "")
    if not match:
        return None
    return (
        f"https://api.ashbyhq.com/posting-api/job-board/{match.group(1)}"
        "?includeCompensation=true"
    )


class AshbyProvider:
    id = "ashby"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        try:
            return _resolve_api_url(entry)
        except ValueError:
            return None

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        api_url = _resolve_api_url(entry)
        if not api_url:
            raise ValueError(f"ashby: cannot derive API URL for {entry.name}")
        assert_host(api_url, ALLOWED_HOSTS, "ashby")

        last_error: Optional[BaseException] = None
        for attempt in range(_RETRIES + 1):
            if attempt > 0 and ctx.sleep:
                # Exponential backoff + jitter — also spaces requests to dodge the
                # rate limiter, not just to wait out a transient failure.
                await ctx.sleep(2 ** (attempt - 1) + random.random() * 0.5)
            try:
                payload = await ctx.fetch_json(api_url, timeout=_TIMEOUT_S)
            except Exception as exc:  # noqa: BLE001 — retried, re-raised below
                last_error = exc
                continue

            jobs = payload.get("jobs") if isinstance(payload, dict) else None
            if not isinstance(jobs, list):
                return []

            postings = []
            for job in jobs:
                if not isinstance(job, dict):
                    continue
                url = job.get("jobUrl") or job.get("applyUrl") or ""
                if not url:
                    continue
                postings.append(
                    Posting(
                        title=job.get("title") or "",
                        url=url,
                        company=entry.name,
                        location=format_location(job),
                        description=strip_html(job.get("descriptionHtml")),
                        posted_at=to_epoch_ms(job.get("publishedAt")),
                        salary=parse_compensation(job),
                    )
                )
            return postings

        raise last_error if last_error else ValueError("ashby: fetch failed")


PROVIDER = AshbyProvider()
