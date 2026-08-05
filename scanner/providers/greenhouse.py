"""Greenhouse — public boards-api JSON endpoint.

Deviation from career-ops (deliberate): this requests `?content=true`. career-ops'
provider omits it and therefore never populates a description, which leaves the
content and visa filters inert on what is charles's largest single source. charles's
previous scraper already fetched content, so keeping it is strictly more capable.
"""
from __future__ import annotations

import re
from typing import Optional

from scanner.providers._common import assert_host, to_epoch_ms
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting, ScanContext

ALLOWED_HOSTS = {
    "boards-api.greenhouse.io",
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "job-boards.eu.greenhouse.io",
}

_BOARD_RE = re.compile(r"job-boards(?:\.eu)?\.greenhouse\.io/([^/?#]+)")
_LEGACY_RE = re.compile(r"boards\.greenhouse\.io/([^/?#]+)")

_TIMEOUT_S = 45.0


def _resolve_api_url(entry: PortalEntry) -> Optional[str]:
    if entry.api:
        assert_host(entry.api, ALLOWED_HOSTS, "greenhouse")
        return entry.api
    url = entry.careers_url or ""
    match = _BOARD_RE.search(url) or _LEGACY_RE.search(url)
    if match:
        return f"https://boards-api.greenhouse.io/v1/boards/{match.group(1)}/jobs"
    return None


class GreenhouseProvider:
    id = "greenhouse"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        try:
            return _resolve_api_url(entry)
        except ValueError:
            return None

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        api_url = _resolve_api_url(entry)
        if not api_url:
            raise ValueError(f"greenhouse: cannot derive API URL for {entry.name}")
        assert_host(api_url, ALLOWED_HOSTS, "greenhouse")

        separator = "&" if "?" in api_url else "?"
        # `content=true` makes the payload an order of magnitude larger (full HTML
        # descriptions for every posting), and a big board like Pinterest exceeds the
        # 10s default. The extra time buys the content and visa filters real signal.
        payload = await ctx.fetch_json(
            f"{api_url}{separator}content=true", timeout=_TIMEOUT_S
        )

        jobs = payload.get("jobs") if isinstance(payload, dict) else None
        if not isinstance(jobs, list):
            return []

        postings = []
        for job in jobs:
            if not isinstance(job, dict) or not job.get("absolute_url"):
                continue
            location = job.get("location") or {}
            postings.append(
                Posting(
                    title=job.get("title") or "",
                    url=job["absolute_url"],
                    company=entry.name,
                    location=location.get("name") or "" if isinstance(location, dict) else "",
                    description=strip_html(job.get("content")),
                    posted_at=to_epoch_ms(job.get("first_published") or job.get("updated_at")),
                )
            )
        return postings


PROVIDER = GreenhouseProvider()
