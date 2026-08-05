"""Rippling ATS — public board API.

The careers host and the API host differ, so the slug is read from
`ats.rippling.com/<slug>` and interpolated into `api.rippling.com`.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from scanner.providers._feed import (
    https_url, join_location, make_json_provider, pick, first_path_segment,
)
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting

CAREERS_HOST = "ats.rippling.com"
API_BASE = "https://api.rippling.com/platform/api/ats/v1/board"
SLUG_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$")


def _api_url(entry: PortalEntry) -> Optional[str]:
    slug = first_path_segment(entry, CAREERS_HOST)
    if not slug or not SLUG_RE.match(slug):
        return None
    return f"{API_BASE}/{quote(slug)}/jobs"


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    return Posting(
        title=pick(row, "name", "title"),
        url=https_url(row.get("url")),
        company=entry.name,
        location=pick(row, "locationName", "location") or join_location(
            *(row.get("workLocation") or {}).values()
            if isinstance(row.get("workLocation"), dict) else ()
        ),
        description=strip_html(row.get("jobDescription") or row.get("description")),
    )


PROVIDER = make_json_provider("rippling", api_url=_api_url, to_posting=_to_posting)
