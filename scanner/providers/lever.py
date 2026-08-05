"""Lever — public v0 postings endpoint.

Lever's list payload ships the full description for free (`descriptionPlain`, same
request, no per-job fetch). Along with Greenhouse's `content=true`, this is what gives
the content and visa filters real signal.
"""
from __future__ import annotations

import re
from typing import Optional

from scanner.providers._common import assert_host, host_of, path_segments, to_epoch_ms
from scanner.types import PortalEntry, Posting, ScanContext

ALLOWED_HOSTS = {"api.lever.co", "api.eu.lever.co"}
_CAREERS_HOST_RE = re.compile(r"^jobs\.((?:eu\.)?lever\.co)$")


def _resolve_api_url(entry: PortalEntry) -> Optional[str]:
    # Explicit api: wins, so an entry can keep a branded careers_url while still
    # pinning the Lever board.
    if entry.api:
        assert_host(entry.api, ALLOWED_HOSTS, "lever")
        return entry.api
    match = _CAREERS_HOST_RE.match(host_of(entry.careers_url or ""))
    if not match:
        return None
    segments = path_segments(entry.careers_url or "")
    if not segments:
        return None
    return f"https://api.{match.group(1)}/v0/postings/{segments[0]}"


class LeverProvider:
    id = "lever"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        try:
            return _resolve_api_url(entry)
        except ValueError:
            return None

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        api_url = _resolve_api_url(entry)
        if not api_url:
            raise ValueError(f"lever: cannot derive API URL for {entry.name}")
        assert_host(api_url, ALLOWED_HOSTS, "lever")

        payload = await ctx.fetch_json(f"{api_url}?mode=json")
        if not isinstance(payload, list):
            return []

        postings = []
        for job in payload:
            if not isinstance(job, dict) or not job.get("hostedUrl"):
                continue
            categories = job.get("categories") or {}
            postings.append(
                Posting(
                    title=job.get("text") or "",
                    url=job["hostedUrl"],
                    company=entry.name,
                    location=categories.get("location") or "" if isinstance(categories, dict) else "",
                    description=job.get("descriptionPlain") or "",
                    posted_at=to_epoch_ms(job.get("createdAt")),
                )
            )
        return postings


PROVIDER = LeverProvider()
