# api/routers/scanner.py
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from scanner.registry import load_providers, resolve_provider
from scanner.sources._registry import load_sources
from scanner.service import preview_scan, scan_all, scan_one, start_run
from scanner.types import PortalEntry
from storage.models import BoardHealth, ScanRun, TrackedCompany
from storage.repository import (
    board_failure_streaks,
    delete_tracked_company,
    get_or_create_scan_config,
    list_source_configs,
    list_tracked_companies,
    purge_jobs,
    save_source_config,
    save_scan_config,
    scan_config_to_dict,
    upsert_tracked_company,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class ScanConfigOut(BaseModel):
    title_filter: Optional[dict] = None
    location_filter: Optional[dict] = None
    content_filter: Optional[dict] = None
    visa_filter: Optional[dict] = None
    salary_filter: Optional[dict] = None
    trust_filter: Optional[dict] = None
    seniority_tiers: Optional[list] = None
    max_posting_age_days: Optional[int] = None
    blocked_companies: Optional[list] = None
    company_aliases: Optional[dict] = None
    include_undated: bool = False
    concurrency: int = 10


class CompanyIn(BaseModel):
    name: str
    careers_url: str = ""
    api_url: Optional[str] = None
    provider: Optional[str] = None
    enabled: bool = True
    max_pages: Optional[int] = None
    notes: Optional[str] = None


class CompanyOut(CompanyIn):
    id: int
    # Echoed back so the UI can confirm a pasted careers URL actually resolves to an
    # ATS. A null here is the signal that the URL is wrong — the failure mode that
    # previously hid behind silent 404s.
    resolved_provider: Optional[str] = None

    model_config = {"from_attributes": True}


class RunIn(BaseModel):
    """Run one source, or every enabled source when `all` is set."""

    source_id: Optional[str] = None
    all: bool = False
    dry_run: bool = False
    max_posting_age_days: Optional[int] = None
    include_undated: Optional[bool] = None


class PreviewIn(BaseModel):
    """Candidate filter settings to try. Anything omitted falls back to the saved
    config, so the UI can preview a single changed field."""

    title_filter: Optional[dict] = None
    location_filter: Optional[dict] = None
    content_filter: Optional[dict] = None
    visa_filter: Optional[dict] = None
    salary_filter: Optional[dict] = None
    seniority_tiers: Optional[list] = None
    max_posting_age_days: Optional[int] = None
    blocked_companies: Optional[list] = None
    source_id: str = "tracked"
    limit_companies: int = 25


# ── Config ──────────────────────────────────────────────────────────

@router.get("/scanner/config", response_model=ScanConfigOut)
async def get_config(session: AsyncSession = Depends(get_db)) -> ScanConfigOut:
    row = await get_or_create_scan_config(session)
    return ScanConfigOut(**scan_config_to_dict(row))


@router.put("/scanner/config", response_model=ScanConfigOut)
async def put_config(
    payload: ScanConfigOut, session: AsyncSession = Depends(get_db)
) -> ScanConfigOut:
    row = await save_scan_config(session, payload.model_dump())
    return ScanConfigOut(**scan_config_to_dict(row))


# ── Tracked companies ───────────────────────────────────────────────

def _resolved_provider_id(row: TrackedCompany) -> Optional[str]:
    entry = PortalEntry(
        name=row.name,
        careers_url=row.careers_url or "",
        api=row.api_url,
        provider=row.provider,
    )
    provider, _error = resolve_provider(entry)
    return provider.id if provider else None


@router.get("/scanner/companies", response_model=list[CompanyOut])
async def get_companies(session: AsyncSession = Depends(get_db)) -> list[CompanyOut]:
    rows = await list_tracked_companies(session)
    return [
        CompanyOut(**{
            "id": row.id,
            "name": row.name,
            "careers_url": row.careers_url,
            "api_url": row.api_url,
            "provider": row.provider,
            "enabled": row.enabled,
            "max_pages": row.max_pages,
            "notes": row.notes,
            "resolved_provider": _resolved_provider_id(row),
        })
        for row in rows
    ]


@router.post("/scanner/companies", response_model=CompanyOut)
async def post_company(
    payload: CompanyIn, session: AsyncSession = Depends(get_db)
) -> CompanyOut:
    row = await upsert_tracked_company(session, payload.model_dump())
    return CompanyOut(
        **payload.model_dump(), id=row.id, resolved_provider=_resolved_provider_id(row)
    )


@router.delete("/scanner/companies/{company_id}")
async def remove_company(
    company_id: int, session: AsyncSession = Depends(get_db)
) -> dict[str, bool]:
    ok = await delete_tracked_company(session, company_id)
    if not ok:
        raise HTTPException(status_code=404, detail="company not found")
    return {"deleted": True}


@router.get("/scanner/providers")
async def get_providers() -> dict[str, list[str]]:
    return {"providers": sorted(load_providers().keys())}


# ── Sources ─────────────────────────────────────────────────────────

class SourceIn(BaseModel):
    enabled: Optional[bool] = None
    settings: Optional[dict] = None


class SourceOut(BaseModel):
    id: str
    label: str
    profile: str
    enabled: bool
    settings: dict
    last_run: Optional[dict] = None


@router.get("/scanner/sources", response_model=list[SourceOut])
async def get_sources(session: AsyncSession = Depends(get_db)) -> list[SourceOut]:
    registered = load_sources()
    configs = await list_source_configs(session)

    # Newest run per source, for the one-line summary on each row.
    runs = (
        await session.execute(select(ScanRun).order_by(desc(ScanRun.started_at)).limit(200))
    ).scalars().all()
    latest: dict[str, ScanRun] = {}
    for run in runs:
        latest.setdefault(run.source_id, run)

    out = []
    for source_id, source in sorted(registered.items(), key=lambda kv: kv[1].label.lower()):
        row = configs.get(source_id)
        run = latest.get(source_id)
        out.append(SourceOut(
            id=source_id,
            label=source.label,
            profile=source.profile,
            enabled=bool(row and row.enabled),
            settings=(row.settings if row and row.settings else {}),
            last_run=None if run is None else {
                "started_at": run.started_at.isoformat(),
                "status": run.status,
                "found": run.found,
                "kept": run.new_added + run.refreshed,
                "new_added": run.new_added,
                "errors": run.errors,
            },
        ))
    return out


@router.put("/scanner/sources/{source_id}", response_model=SourceOut)
async def put_source(
    source_id: str, payload: SourceIn, session: AsyncSession = Depends(get_db)
) -> SourceOut:
    if source_id not in load_sources():
        raise HTTPException(status_code=404, detail=f"unknown source: {source_id}")
    await save_source_config(session, source_id, payload.model_dump(exclude_none=True))
    return next(s for s in await get_sources(session) if s.id == source_id)


# ── Runs ────────────────────────────────────────────────────────────

@router.post("/scanner/run", status_code=202)
async def trigger_run(payload: RunIn = RunIn()) -> dict[str, Any]:
    """Start a sweep and return at once with its id.

    202, not 200: the work has been accepted, not finished. Holding the request open
    for the forty minutes a sweep takes made the UI's notion of "running" a property
    of one tab's fetch -- the dev proxy timed out at five minutes, the tab said
    "Failed", and the sweep continued unseen. Clients read `/scanner/progress` for
    state now, so every tab agrees and a reload sees the truth.
    """
    if not payload.all:
        if not payload.source_id:
            raise HTTPException(status_code=400, detail="source_id or all is required")
        if payload.source_id not in load_sources():
            raise HTTPException(status_code=404, detail=f"unknown source: {payload.source_id}")
    return await start_run(
        source_id=payload.source_id,
        all_sources=bool(payload.all),
        dry_run=payload.dry_run,
        overrides={
            "max_posting_age_days": payload.max_posting_age_days,
            "include_undated": payload.include_undated,
        },
    )


@router.post("/scanner/cancel")
async def cancel_run() -> dict[str, Any]:
    """Stop the running sweep. Idempotent: cancelling nothing is not an error."""
    from scanner import progress

    stopped = await progress.cancel()
    return {"cancelled": stopped, **progress.snapshot()}


@router.post("/scanner/preview")
async def trigger_preview(
    payload: PreviewIn = PreviewIn(), session: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    overrides = payload.model_dump(exclude={"limit_companies", "source_id"})
    return await preview_scan(
        session,
        source_id=payload.source_id,
        overrides=overrides,
        limit_companies=payload.limit_companies,
    )


class RunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: Optional[datetime]
    source_id: str
    status: str
    dry_run: bool
    companies: int
    found: int
    filtered_blacklist: int
    filtered_title: int
    filtered_tier: int
    filtered_location: int
    filtered_posted_date: int
    filtered_salary: int
    filtered_content: int
    filtered_visa: int
    dropped_stale: int
    dropped_no_date: int
    dupes: int
    new_added: int
    refreshed: int
    delisted: int
    errors: int
    companies_available: int
    companies_scanned: int
    cap_hit: bool
    unreachable_boards: int
    # Boards never requested because they are on the dead-board list. Without this the
    # drop in `companies_scanned` between runs would look like the sweep shrinking
    # rather than the skip working.
    boards_skipped_dead: int = 0
    drops: Optional[dict] = None

    model_config = {"from_attributes": True}


@router.post("/scanner/purge")
async def purge(session: AsyncSession = Depends(get_db)) -> dict[str, int]:
    """Drop every stored posting. Irreversible, so the UI gates it behind a confirm."""
    return {"deleted": await purge_jobs(session)}


@router.get("/scanner/progress")
async def get_progress() -> dict[str, Any]:
    """Live state of the scan currently running, if any.

    Deliberately takes no DB session: it is polled once a second for up to forty
    minutes while a sweep holds a long transaction, and it must never queue behind it.
    """
    from scanner import progress

    return progress.snapshot()


@router.get("/scanner/runs", response_model=list[RunOut])
async def get_runs(
    limit: int = 25, session: AsyncSession = Depends(get_db)
) -> list[RunOut]:
    result = await session.execute(
        select(ScanRun).order_by(desc(ScanRun.started_at)).limit(min(limit, 100))
    )
    return list(result.scalars().all())


# ── Health ──────────────────────────────────────────────────────────

@router.get("/scanner/health")
async def get_health(session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Latest status per company plus its consecutive-failure streak.

    A streak of 3+ means the board has been unreachable across several runs — a wrong
    slug or a migrated ATS, not a transient blip.
    """
    streaks = await board_failure_streaks(session)
    result = await session.execute(
        select(BoardHealth).order_by(desc(BoardHealth.timestamp), desc(BoardHealth.id))
    )
    latest: dict[str, dict] = {}
    for row in result.scalars().all():
        if row.company in latest:
            continue
        latest[row.company] = {
            "company": row.company,
            "status": row.status,
            "detail": row.detail,
            "timestamp": row.timestamp,
            "streak": streaks.get(row.company, 0),
        }
    boards = sorted(latest.values(), key=lambda b: (-b["streak"], b["company"]))
    return {
        "boards": boards,
        "failing": [b for b in boards if b["streak"] >= 3],
    }
