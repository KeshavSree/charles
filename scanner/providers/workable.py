"""Workable — public markdown feed.

Workable's JSON API requires an auth token; the markdown feed at
`/<slug>/jobs.md` is the only zero-auth public surface, so this parses a table.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlsplit

from scanner.providers._common import assert_host
from scanner.providers._feed import first_path_segment
from scanner.types import PortalEntry, Posting, ScanContext

ALLOWED_HOSTS = {"apply.workable.com"}
_VIEW_RE = re.compile(r"\[View\]\(([^)]+)\)")


def _feed_url(entry: PortalEntry) -> Optional[str]:
    slug = first_path_segment(entry, "apply.workable.com")
    return f"https://apply.workable.com/{slug}/jobs.md" if slug else None


def parse_markdown(text: str, company: str) -> list[Posting]:
    """Table columns: | Title | Dept | Location | Type | Salary | Posted | Details |
    where Details holds `[View](https://apply.workable.com/<slug>/jobs/view/<id>.md)`."""
    if not isinstance(text, str):
        return []
    postings = []
    for line in text.split("\n"):
        if not line.startswith("|") or "[View]" not in line:
            continue
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 8:
            continue
        title = cols[1]
        if not title or title == "Title":
            continue
        match = _VIEW_RE.search(line)
        url = match.group(1) if match else ""
        if url.endswith(".md"):
            url = url[:-3]
        # Off-domain or non-HTTPS [View] links are dropped rather than emitted.
        try:
            parts = urlsplit(url)
        except (ValueError, UnicodeError):
            continue
        if parts.scheme != "https" or parts.hostname != "apply.workable.com":
            continue
        postings.append(
            Posting(title=title, url=url, company=company, location=cols[3] or "")
        )
    return postings


class WorkableProvider:
    id = "workable"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        return _feed_url(entry)

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        url = _feed_url(entry)
        if not url:
            raise ValueError(f"workable: cannot derive feed URL for {entry.name}")
        assert_host(url, ALLOWED_HOSTS, "workable")
        return parse_markdown(await ctx.fetch_text(url), entry.name)


PROVIDER = WorkableProvider()
