# api/routers/jobs.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import Job

router = APIRouter()


class JobOut(BaseModel):
    id: str
    source: str
    company: str
    title: str
    url: str
    location: Optional[str]
    posted_at: Optional[datetime]
    updated_at: Optional[datetime]
    seniority: str
    scraped_at: datetime

    model_config = {"from_attributes": True}


class FiltersOut(BaseModel):
    companies: list[str]
    sources: list[str]


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    search: Optional[str] = None,
    company: Optional[str] = None,
    source: Optional[str] = None,
    seniority: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
    session: AsyncSession = Depends(get_db),
) -> list[JobOut]:
    stmt = select(Job)
    if search:
        stmt = stmt.where(Job.title.ilike(f"%{search}%"))
    if company:
        stmt = stmt.where(Job.company == company)
    if source:
        stmt = stmt.where(Job.source == source)
    if seniority:
        stmt = stmt.where(Job.seniority == seniority)
    stmt = stmt.order_by(Job.scraped_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/jobs/filters", response_model=FiltersOut)
async def get_filters(session: AsyncSession = Depends(get_db)) -> FiltersOut:
    companies = list(
        (await session.execute(select(distinct(Job.company)).order_by(Job.company))).scalars().all()
    )
    sources = list(
        (await session.execute(select(distinct(Job.source)).order_by(Job.source))).scalars().all()
    )
    return FiltersOut(companies=companies, sources=sources)
