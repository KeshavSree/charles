"""Comeet — public careers-api positions endpoint.

Unlike the other ATSes there is no derivable slug: the endpoint carries a per-company
token, so an entry must supply the full careers-api URL via `api`. The token is
redacted from anything logged.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlsplit

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import https_url, join_location, make_json_provider, pick
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting

API_HOST = "www.comeet.co"


def redact_token(url: str) -> str:
    import re
    return re.sub(r"([?&]token=)[^&#]*", r"\1REDACTED", url or "")


def _is_api_url(raw: object) -> bool:
    if not isinstance(raw, str) or not raw:
        return False
    try:
        parts = urlsplit(raw)
    except (ValueError, UnicodeError):
        return False
    return (
        parts.scheme == "https"
        and parts.hostname == API_HOST
        and parts.path.startswith("/careers-api/")
    )


def _api_url(entry: PortalEntry) -> Optional[str]:
    for raw in (entry.api, entry.careers_url):
        if _is_api_url(raw):
            return raw
    return None


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    location = row.get("location") if isinstance(row.get("location"), dict) else {}
    return Posting(
        title=pick(row, "name", "title"),
        url=https_url(row.get("url_comeet_hosted_page") or row.get("url_active_page")),
        company=entry.name,
        location=pick(row, "location_name") or join_location(
            location.get("city"), location.get("country")
        ),
        description=strip_html(row.get("details")),
        posted_at=to_epoch_ms(row.get("time_updated")),
    )


PROVIDER = make_json_provider("comeet", api_url=_api_url, to_posting=_to_posting)
