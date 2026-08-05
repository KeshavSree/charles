"""Teamtailor — per-tenant public RSS jobs feed.

Auto-detection stays pinned to `*.teamtailor.com` so an untrusted careers URL can
never steer the fetch at an arbitrary host. Many tenants also serve the same feed on
a branded domain; that is honored only when the user explicitly opts in with
`provider: teamtailor`.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlsplit

from scanner.providers._feed import make_rss_provider, xml_text
from scanner.types import PortalEntry

HOST_RE = re.compile(r"^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.teamtailor\.com$", re.I)


def _feed_url(entry: PortalEntry) -> Optional[str]:
    explicit = entry.provider == "teamtailor"
    raw = entry.api or entry.careers_url or ""
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parts = urlsplit(raw)
    except (ValueError, UnicodeError):
        return None
    if parts.scheme != "https" or not parts.hostname:
        return None
    if not explicit and not HOST_RE.match(parts.hostname):
        return None
    return f"https://{parts.hostname}/jobs.rss"


def _location(item: str) -> str:
    city = xml_text(item, "tt:city")
    country = xml_text(item, "tt:country")
    place = ", ".join(p for p in (city, country) if p)
    if place:
        return place
    remote = xml_text(item, "remoteStatus").lower()
    return "Remote" if remote in ("fully", "temporary") else ""


PROVIDER = make_rss_provider("teamtailor", feed_url=_feed_url, location_of=_location)
