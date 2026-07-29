# api/routers/jobs.py
from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import Job

router = APIRouter()

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
# Counting an unbounded result set on every keystroke is a full table scan. Stop at
# this many and report "N+" instead — the exact total past a thousand is never the
# thing a user needs.
COUNT_CEILING = 1000


class JobOut(BaseModel):
    id: str
    provider_id: str
    discovery: str
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


class FiltersOut(BaseModel):
    companies: list[str]
    providers: list[str]
    tiers: list[str]


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


@router.get("/jobs", response_model=JobsPage)
async def list_jobs(
    search: Optional[str] = None,
    company: Optional[str] = None,
    provider_id: Optional[str] = None,
    tier: Optional[str] = None,
    location: Optional[str] = None,
    status: str = "active",
    discovery: Optional[str] = None,
    posted_after: Optional[datetime] = None,
    posted_before: Optional[datetime] = None,
    salary_min: Optional[float] = None,
    trust_min: Optional[int] = None,
    has_description: Optional[bool] = None,
    q: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: AsyncSession = Depends(get_db),
) -> JobsPage:
    """View filters over what is already stored.

    Distinct from the scanner's ingest filters, which decide what is ever written.
    These only narrow the view and are freely reversible.

    Pagination is keyset, not OFFSET: the directory sweep produces tens of thousands
    of rows, and `OFFSET 20000` makes SQLite walk 20,000 rows just to discard them.
    """
    conditions = []
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
    if discovery:
        conditions.append(Job.discovery == discovery)
    if posted_after:
        conditions.append(Job.posted_at >= posted_after)
    if posted_before:
        conditions.append(Job.posted_at <= posted_before)
    if salary_min is not None:
        # A posting with no salary data passes — most providers expose none, and
        # excluding them would hide the majority of real results.
        conditions.append(
            or_(Job.salary_max.is_(None), Job.salary_max >= salary_min)
        )
    if trust_min is not None:
        conditions.append(or_(Job.trust_score.is_(None), Job.trust_score >= trust_min))
    if has_description is True:
        conditions.append(Job.description.isnot(None))
    elif has_description is False:
        conditions.append(Job.description.is_(None))

    base = select(Job)
    if conditions:
        base = base.where(and_(*conditions))

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
    return FiltersOut(companies=companies, providers=providers, tiers=tiers)
