"""Jobvite — public company jobs API."""
from __future__ import annotations

from typing import Optional
from urllib.parse import quote, urlsplit

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import https_url, join_location, make_json_provider, pick
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting

HOST = "jobs.jobvite.com"


def _company_id(entry: PortalEntry) -> Optional[str]:
    for raw in (entry.api, entry.careers_url):
        if not isinstance(raw, str) or not raw:
            continue
        try:
            parts = urlsplit(raw)
        except (ValueError, UnicodeError):
            continue
        if parts.scheme != "https" or parts.hostname != HOST:
            continue
        segments = [s for s in parts.path.split("/") if s]
        if "company" in segments:
            index = segments.index("company")
            if index + 1 < len(segments):
                return segments[index + 1]
        if segments and segments[0] != "api":
            return segments[0]
    return None


def _api_url(entry: PortalEntry) -> Optional[str]:
    company_id = _company_id(entry)
    return f"https://{HOST}/api/company/{quote(company_id)}/jobs" if company_id else None


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    return Posting(
        title=pick(row, "title", "name"),
        url=https_url(row.get("applyUrl") or row.get("url")),
        company=entry.name,
        location=pick(row, "location") or join_location(
            row.get("city"), row.get("state"), row.get("country")
        ),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(row.get("postedDate") or row.get("date")),
    )


PROVIDER = make_json_provider(
    "jobvite", api_url=_api_url, row_paths=("jobs", "requisitions"), to_posting=_to_posting
)
