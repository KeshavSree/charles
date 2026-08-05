"""BambooHR — public per-tenant careers list."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from scanner.providers._feed import join_location, make_json_provider, pick, tenant_origin
from scanner.types import PortalEntry, Posting

HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.bamboohr\.com$")


def _api_url(entry: PortalEntry) -> Optional[str]:
    origin = tenant_origin(entry, HOST_RE)
    return f"{origin}/careers/list" if origin else None


def _to_posting(row: dict, entry: PortalEntry) -> Optional[Posting]:
    job_id = str(row.get("id") or "").strip()
    if not job_id:
        return None
    origin = tenant_origin(entry, HOST_RE)
    location = row.get("location") if isinstance(row.get("location"), dict) else {}
    return Posting(
        title=pick(row, "jobOpeningName"),
        url=f"{origin}/careers/{quote(job_id)}",
        company=entry.name,
        location=join_location(
            location.get("city"), location.get("state"), remote=bool(row.get("isRemote"))
        ),
    )


PROVIDER = make_json_provider(
    "bamboohr", api_url=_api_url, row_paths=("result",), to_posting=_to_posting
)
