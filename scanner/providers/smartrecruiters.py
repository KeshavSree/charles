"""SmartRecruiters — public postings API, paginated."""
from __future__ import annotations

from typing import Optional

from scanner.providers._common import assert_host
from scanner.providers._feed import first_path_segment, join_location
from scanner.types import PortalEntry, Posting, ScanContext

ALLOWED_HOSTS = {"api.smartrecruiters.com"}
CAREERS_HOSTS = ("careers.smartrecruiters.com", "jobs.smartrecruiters.com")
PAGE_SIZE = 100
MAX_PAGES = 50  # 5,000 postings — a safety cap, not a working limit


def _slug(entry: PortalEntry) -> Optional[str]:
    for host in CAREERS_HOSTS:
        segment = first_path_segment(entry, host)
        if segment:
            return segment
    return None


def _url(slug: str, offset: int = 0) -> str:
    return (
        f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
        f"?limit={PAGE_SIZE}&offset={offset}&status=PUBLIC"
    )


def _slugify(value: str) -> str:
    import re
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", (value or "").lower()))


def parse_response(payload: object, company: str) -> list[Posting]:
    items = payload.get("content") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    postings = []
    for row in items:
        if not isinstance(row, dict):
            continue
        location = row.get("location") or {}
        full = location.get("fullLocation") or join_location(
            location.get("city"), location.get("region"), location.get("country")
        )
        title = row.get("name") or ""
        # `ref` points at the API URL; the public site has no /postings/ segment, and
        # carrying it over yields a 404 that a liveness check would misread as an
        # expired posting. SmartRecruiters resolves by id alone, so the title slug is
        # cosmetic.
        job_id = row.get("id")
        url = ""
        if job_id:
            slug_part = f"-{_slugify(title)}" if title else ""
            url = f"https://jobs.smartrecruiters.com/{company}/{job_id}{slug_part}"
        postings.append(
            Posting(
                title=title,
                url=url,
                company=company,
                location=join_location(full, remote=bool(location.get("remote"))),
            )
        )
    return postings


class SmartRecruitersProvider:
    id = "smartrecruiters"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        slug = _slug(entry)
        return _url(slug) if slug else None

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        slug = _slug(entry)
        if not slug:
            raise ValueError(f"smartrecruiters: cannot derive API URL for {entry.name}")
        out: list[Posting] = []
        for page in range(MAX_PAGES):
            url = assert_host(_url(slug, page * PAGE_SIZE), ALLOWED_HOSTS, "smartrecruiters")
            parsed = parse_response(await ctx.fetch_json(url), slug)
            if not parsed:
                break
            for posting in parsed:
                posting.company = entry.name
            out.extend(parsed)
            if len(parsed) < PAGE_SIZE:
                break
        return out


PROVIDER = SmartRecruitersProvider()
