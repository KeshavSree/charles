"""Pinpoint — public per-tenant postings feed."""
from __future__ import annotations

import re
from typing import Optional

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import (
    https_url, join_location, make_json_provider, pick, tenant_origin,
)
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting

HOST_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pinpointhq\.com$")


def _api_url(entry: PortalEntry) -> Optional[str]:
    origin = tenant_origin(entry, HOST_RE)
    return f"{origin}/postings.json" if origin else None


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    location = row.get("location") if isinstance(row.get("location"), dict) else {}
    return Posting(
        title=pick(row, "title"),
        url=https_url(row.get("url")),
        company=entry.name,
        location=join_location(
            location.get("name"), remote=bool(row.get("remote") or location.get("remote"))
        ),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(row.get("published_at") or row.get("created_at")),
    )


PROVIDER = make_json_provider(
    "pinpoint", api_url=_api_url, row_paths=("data",), to_posting=_to_posting
)
