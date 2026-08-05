# api/routers/jobs.py
from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, delete, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import Job, PipelineEntry
from storage.repository import set_job_status

router = APIRouter()

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
# Counting an unbounded result set on every keystroke is a full table scan. Stop at
# this many and report "N+" instead — the exact total past a thousand is never the
# thing a user needs.
COUNT_CEILING = 1000
# Ids per DELETE statement. SQLite's default bind-parameter ceiling is 999, and a purge
# can easily name tens of thousands of rows.
DELETE_CHUNK = 500


class JobOut(BaseModel):
    id: str
    provider_id: str
    source_id: str
    company: str
    title: str
    url: str
    location: Optional[str]
    posted_at: Optional[datetime]
    first_seen_at: datetime
    last_seen_at: datetime
    tier: str
    status: str
    salary_min: Optional[float]
    salary_max: Optional[float]
    salary_currency: Optional[str]
    trust_score: Optional[int]
    trust_flags: Optional[list]

    model_config = {"from_attributes": True}


class JobsPage(BaseModel):
    items: list[JobOut]
    next_cursor: Optional[str]
    total: int
    total_is_capped: bool


class PurgeOut(BaseModel):
    deleted: int


class FiltersOut(BaseModel):
    companies: list[str]
    providers: list[str]
    tiers: list[str]
    sources: list[str]


def _encode_cursor(job: Job) -> str:
    payload = {
        "p": job.posted_at.isoformat() if job.posted_at else None,
        "i": job.id,
    }
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def _decode_cursor(cursor: str) -> Optional[tuple[Optional[datetime], str]]:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        posted = datetime.fromisoformat(payload["p"]) if payload.get("p") else None
        return posted, payload["i"]
    except Exception:  # noqa: BLE001 — a malformed cursor restarts from page one
        return None


class JobQuery:
    """Compiled view filters. Built by the `job_query` dependency below."""

    def __init__(self, conditions: list) -> None:
        self.conditions = conditions

    def apply(self, stmt):
        return stmt.where(and_(*self.conditions)) if self.conditions else stmt


def job_query(
    search: Optional[str] = None,
    company: Optional[str] = None,
    provider_id: Optional[str] = None,
    tier: Optional[str] = None,
    location: Optional[str] = None,
    status: str = "active",
    source_id: Optional[str] = None,
    posted_after: Optional[datetime] = None,
    posted_before: Optional[datetime] = None,
    salary_min: Optional[float] = None,
    trust_min: Optional[int] = None,
    has_description: Optional[bool] = None,
    q: Optional[str] = None,
    exclude_pipeline: bool = True,
) -> JobQuery:
    """The view filters, shared by the list and purge endpoints.

    A single definition on purpose: the purge deletes exactly what the list shows, and
    the only way to guarantee that is for both to compile the same conditions from the
    same params. Two copies of this logic would drift, and the failure mode is deleting
    rows the user never saw.

    A function rather than a class dependency: this module uses
    `from __future__ import annotations`, and FastAPI cannot resolve the resulting
    string hints on a class `__init__`.

    Distinct from the scanner's ingest filters, which decide what is ever *written*.
    These only narrow the view — reversible, except when handed to the purge.
    """
    conditions = []
    if exclude_pipeline:
        # Once a job is in the pipeline it lives on /pipeline, not here — the jobs list
        # is the inbox of things not yet triaged. Off by param so the purge and any
        # future "show everything" view can still see them.
        conditions.append(~Job.id.in_(select(PipelineEntry.job_id)))
    if search:
        conditions.append(Job.title.ilike(f"%{search}%"))
    if q:
        conditions.append(
            or_(Job.description.ilike(f"%{q}%"), Job.title.ilike(f"%{q}%"))
        )
    if company:
        conditions.append(Job.company == company)
    if provider_id:
        conditions.append(Job.provider_id == provider_id)
    if tier:
        conditions.append(Job.tier == tier)
    if location:
        conditions.append(Job.location.ilike(f"%{location}%"))
    if status and status != "any":
        conditions.append(Job.status == status)
    if source_id:
        conditions.append(Job.source_id == source_id)
    if posted_after:
        conditions.append(Job.posted_at >= posted_after)
    if posted_before:
        conditions.append(Job.posted_at <= posted_before)
    if salary_min is not None:
        # A posting with no salary data passes — most providers expose none, and
        # excluding them would hide the majority of real results.
        conditions.append(or_(Job.salary_max.is_(None), Job.salary_max >= salary_min))
    if trust_min is not None:
        conditions.append(or_(Job.trust_score.is_(None), Job.trust_score >= trust_min))
    if has_description is True:
        conditions.append(Job.description.isnot(None))
    elif has_description is False:
        conditions.append(Job.description.is_(None))
    return JobQuery(conditions)


@router.get("/jobs", response_model=JobsPage)
async def list_jobs(
    filters: JobQuery = Depends(job_query),
    cursor: Optional[str] = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: AsyncSession = Depends(get_db),
) -> JobsPage:
    """The stored postings matching the current view filters.

    Pagination is keyset, not OFFSET: the directory sweep produces tens of thousands
    of rows, and `OFFSET 20000` makes SQLite walk 20,000 rows just to discard them.
    """
    base = filters.apply(select(Job))

    # Newest first, with id as the tiebreaker so the cursor is total-ordered.
    ordered = base.order_by(Job.posted_at.desc().nullslast(), Job.id.desc())

    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded:
            last_posted, last_id = decoded
            if last_posted is None:
                # Already inside the undated tail — only ids below the cursor remain.
                ordered = ordered.where(
                    and_(Job.posted_at.is_(None), Job.id < last_id)
                )
            else:
                ordered = ordered.where(
                    or_(
                        Job.posted_at < last_posted,
                        and_(Job.posted_at == last_posted, Job.id < last_id),
                        Job.posted_at.is_(None),
                    )
                )

    rows = list((await session.execute(ordered.limit(limit + 1))).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]

    capped = select(func.count()).select_from(
        base.limit(COUNT_CEILING + 1).subquery()
    )
    total = (await session.execute(capped)).scalar_one()

    return JobsPage(
        items=[JobOut.model_validate(r) for r in rows],
        next_cursor=_encode_cursor(rows[-1]) if has_more and rows else None,
        total=total,
        total_is_capped=total > COUNT_CEILING,
    )


@router.post("/jobs/{job_id}/dismiss", response_model=JobOut)
async def dismiss_job(
    job_id: str, restore: bool = False, session: AsyncSession = Depends(get_db)
) -> JobOut:
    """Reject a posting, or put it back with `restore=true`.

    A status change rather than a delete, because a deleted row is simply re-found by
    the next scan. 'dismissed' is preserved across rescans (see persist_postings) and
    ignored by the delisting pass, so the rejection sticks.
    """
    job = await set_job_status(session, job_id, "active" if restore else "dismissed")
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return JobOut.model_validate(job)


@router.post("/jobs/purge", response_model=PurgeOut)
async def purge_listed(
    filters: JobQuery = Depends(job_query), session: AsyncSession = Depends(get_db)
) -> PurgeOut:
    """Delete the jobs matching the current view filters, except those in the pipeline.

    Destructive and not undoable — the rows are gone until the next scan re-finds them.
    Scoped to the same conditions the list endpoint uses (see JobQuery), so what is
    deleted is exactly what was on screen.

    Pipeline jobs are spared. The default view already excludes them, so this is a
    backstop for an explicit `exclude_pipeline=false`: a job you have actively applied
    to should not vanish because you purged a view it happened to match. It also keeps
    `pipeline_entries.job_id` from being left pointing at nothing.
    """
    doomed = filters.apply(select(Job.id)).where(
        ~Job.id.in_(select(PipelineEntry.job_id))
    )
    ids = list((await session.execute(doomed)).scalars().all())

    # Deleted by explicit id list rather than re-running the filter as a DELETE
    # subquery, so the rows removed are precisely the ones counted above even if a scan
    # writes concurrently. Chunked because SQLite caps how many bind parameters one
    # statement may carry, and a directory sweep can leave tens of thousands of rows.
    for start in range(0, len(ids), DELETE_CHUNK):
        await session.execute(
            delete(Job).where(Job.id.in_(ids[start : start + DELETE_CHUNK]))
        )
    if ids:
        await session.commit()

    return PurgeOut(deleted=len(ids))


@router.get("/jobs/filters", response_model=FiltersOut)
async def get_filters(session: AsyncSession = Depends(get_db)) -> FiltersOut:
    companies = list(
        (await session.execute(select(distinct(Job.company)).order_by(Job.company)))
        .scalars()
        .all()
    )
    providers = list(
        (await session.execute(select(distinct(Job.provider_id)).order_by(Job.provider_id)))
        .scalars()
        .all()
    )
    tiers = list(
        (await session.execute(select(distinct(Job.tier)).order_by(Job.tier))).scalars().all()
    )
    sources = list(
        (await session.execute(select(distinct(Job.source_id)).order_by(Job.source_id)))
        .scalars()
        .all()
    )
    return FiltersOut(companies=companies, providers=providers, tiers=tiers, sources=sources)
