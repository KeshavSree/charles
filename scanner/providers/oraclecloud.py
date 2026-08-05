"""Oracle Cloud (ORC / Candidate Experience) — public recruiting REST API.

Tenants live on `<pod>.fa.<region>.oraclecloud.com`, and the posting URL has to be
rebuilt from the site's lang + siteNumber because the API returns ids, not links.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote, urlsplit

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import https_url, join_location
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting, ScanContext

HOST_RE = re.compile(
    r"^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud\.com$", re.I
)
PAGE_SIZE = 200
MAX_PAGES = 15


def resolve_site(entry: PortalEntry) -> Optional[dict]:
    """Path shape: /hcmUI/CandidateExperience/<lang>/sites/<siteNumber>/..."""
    for raw in (entry.api, entry.careers_url):
        if not isinstance(raw, str) or not raw:
            continue
        try:
            parts = urlsplit(raw)
        except (ValueError, UnicodeError):
            continue
        if parts.scheme != "https" or not parts.hostname:
            continue
        if not HOST_RE.match(parts.hostname):
            continue
        segments = [s for s in parts.path.split("/") if s]
        lang = "en"
        if "CandidateExperience" in segments:
            index = segments.index("CandidateExperience")
            if index + 1 < len(segments):
                lang = segments[index + 1]
        site_number = "CX_1"
        if "sites" in segments:
            index = segments.index("sites")
            if index + 1 < len(segments):
                site_number = segments[index + 1]
        return {"host": parts.hostname, "lang": lang, "site_number": site_number}
    return None


def _api_url(site: dict, offset: int) -> str:
    finder = (
        f"findReqs;siteNumber={site['site_number']},limit={PAGE_SIZE},"
        f"sortBy=POSTING_DATES_DESC,offset={offset}"
    )
    expand = quote("requisitionList.workLocation,requisitionList.secondaryLocations")
    return (
        f"https://{site['host']}/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
        f"?onlyData=true&expand={expand}&finder={finder}"
        f"&limit={PAGE_SIZE}&offset={offset}"
    )


def _job_url(site: dict, job_id: str) -> str:
    return (
        f"https://{site['host']}/hcmUI/CandidateExperience/{site['lang']}"
        f"/sites/{site['site_number']}/job/{job_id}"
    )


def _location(req: dict) -> str:
    base = (req.get("PrimaryLocation") or "").strip()
    if not base:
        work = req.get("workLocation")
        if isinstance(work, list) and work and isinstance(work[0], dict):
            first = work[0]
            base = join_location(
                first.get("TownOrCity"), first.get("Region"), first.get("Country")
            )
    code = req.get("WorkplaceTypeCode")
    hint = "Remote" if code == "ORA_REMOTE" else "Hybrid" if code == "ORA_HYBRID" else ""
    return " · ".join(p for p in (base, hint) if p)


def parse_response(payload: object, site: dict, company: str) -> list[Posting]:
    items = payload.get("items") if isinstance(payload, dict) else None
    first = items[0] if isinstance(items, list) and items else None
    rows = first.get("requisitionList") if isinstance(first, dict) else None
    if not isinstance(rows, list):
        return []
    postings = []
    for req in rows:
        if not isinstance(req, dict):
            continue
        job_id = req.get("Id") or req.get("RequisitionNumber")
        url = https_url(req.get("ExternalURL")) or (
            _job_url(site, str(job_id)) if job_id else ""
        )
        if not url:
            continue  # no link means no dedup key
        postings.append(
            Posting(
                title=req.get("Title") or "",
                url=url,
                company=company,
                location=_location(req),
                description=strip_html(req.get("ShortDescriptionStr")),
                posted_at=to_epoch_ms(req.get("PostedDate")),
            )
        )
    return postings


class OracleCloudProvider:
    id = "oraclecloud"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        site = resolve_site(entry)
        return _api_url(site, 0) if site else None

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        site = resolve_site(entry)
        if not site:
            raise ValueError(f"oraclecloud: cannot derive site for {entry.name}")
        out: list[Posting] = []
        for page in range(MAX_PAGES):
            payload = await ctx.fetch_json(_api_url(site, page * PAGE_SIZE), timeout=30.0)
            parsed = parse_response(payload, site, entry.name)
            if not parsed:
                break
            out.extend(parsed)
            if len(parsed) < PAGE_SIZE:
                break
        return out


PROVIDER = OracleCloudProvider()
