"""Breezy HR — public per-tenant JSON board."""
from __future__ import annotations

import re
from typing import Optional

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import (
    https_url, join_location, make_json_provider, pick, tenant_origin,
)
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting

HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.breezy\.hr$")


def _api_url(entry: PortalEntry) -> Optional[str]:
    origin = tenant_origin(entry, HOST_RE)
    return f"{origin}/json" if origin else None


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    location = row.get("location") or {}
    return Posting(
        title=pick(row, "name", "title"),
        url=https_url(row.get("url")),
        company=entry.name,
        location=join_location(
            (location.get("city") or {}).get("name") if isinstance(location.get("city"), dict)
            else location.get("city"),
            (location.get("country") or {}).get("name") if isinstance(location.get("country"), dict)
            else location.get("country"),
            remote=bool(location.get("is_remote")),
        ),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(row.get("published_date") or row.get("creation_date")),
    )


PROVIDER = make_json_provider("breezy", api_url=_api_url, to_posting=_to_posting)
