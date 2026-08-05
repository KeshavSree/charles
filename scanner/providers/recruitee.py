"""Recruitee — public per-tenant offers API."""
from __future__ import annotations

import re
from typing import Optional

from scanner.providers._feed import (
    https_url, join_location, make_json_provider, pick, tenant_origin,
)
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting

HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.recruitee\.com$")


def _api_url(entry: PortalEntry) -> Optional[str]:
    origin = tenant_origin(entry, HOST_RE)
    return f"{origin}/api/offers/" if origin else None


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    return Posting(
        title=pick(row, "title"),
        # Recruitee tenants commonly publish on their own custom domain, so the offer
        # URL is not host-locked to *.recruitee.com — it is display-only and comes
        # from the already-validated tenant API response.
        url=https_url(row.get("careers_url") or row.get("url")),
        company=entry.name,
        location=pick(row, "location") or join_location(
            row.get("city"), row.get("country"), remote=bool(row.get("remote"))
        ),
        description=strip_html(row.get("description")),
    )


PROVIDER = make_json_provider(
    "recruitee", api_url=_api_url, row_paths=("offers",), to_posting=_to_posting
)
