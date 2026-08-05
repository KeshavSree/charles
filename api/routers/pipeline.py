# api/routers/pipeline.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import PIPELINE_STAGES
from storage.repository import (
    add_to_pipeline,
    get_pipeline_entry,
    list_pipeline,
    pipeline_stage_counts,
    remove_from_pipeline,
    update_pipeline_entry,
)

router = APIRouter()


class PipelineJobOut(BaseModel):
    """A pipeline entry flattened together with the job it points at.

    The frontend renders one thin row per entry, so shipping them joined saves it
    from stitching two lists together.
    """

    job_id: str
    stage: str
    outcome: Optional[str]
    contact_email: Optional[str]
    notes: Optional[str]
    added_at: datetime
    last_interacted_at: datetime

    company: str
    title: str
    url: str
    location: Optional[str]
    provider_id: str
    tier: str
    status: str
    posted_at: Optional[datetime]
    salary_min: Optional[float]
    salary_max: Optional[float]
    salary_currency: Optional[str]


class PipelineOut(BaseModel):
    items: list[PipelineJobOut]
    counts: dict[str, int]
    stages: list[str]


class AddIn(BaseModel):
    job_id: str


class UpdateIn(BaseModel):
    stage: Optional[str] = None
    outcome: Optional[str] = None
    notes: Optional[str] = None
    # Empty string clears it; null leaves it alone.
    contact_email: Optional[str] = None
    # Distinguishes "clear the result" from "leave it alone" — a null `outcome`
    # already means the latter.
    clear_outcome: bool = False


def _flatten(entry, job) -> PipelineJobOut:
    return PipelineJobOut(
        job_id=entry.job_id,
        stage=entry.stage,
        outcome=entry.outcome,
        contact_email=entry.contact_email,
        notes=entry.notes,
        added_at=entry.added_at,
        last_interacted_at=entry.last_interacted_at,
        company=job.company,
        title=job.title,
        url=job.url,
        location=job.location,
        provider_id=job.provider_id,
        tier=job.tier,
        status=job.status,
        posted_at=job.posted_at,
        salary_min=job.salary_min,
        salary_max=job.salary_max,
        salary_currency=job.salary_currency,
    )


@router.get("/pipeline", response_model=PipelineOut)
async def get_pipeline(
    stage: Optional[str] = None, session: AsyncSession = Depends(get_db)
) -> PipelineOut:
    """The whole pipeline, or one stage of it.

    Unpaginated on purpose: this list is hand-curated one '+' click at a time, so it
    stays in the dozens, not the tens of thousands the jobs table holds.
    """
    if stage and stage not in PIPELINE_STAGES:
        raise HTTPException(status_code=400, detail=f"unknown stage: {stage}")
    rows = await list_pipeline(session, stage=stage)
    return PipelineOut(
        items=[_flatten(e, j) for e, j in rows],
        counts=await pipeline_stage_counts(session),
        stages=list(PIPELINE_STAGES),
    )


@router.post("/pipeline", response_model=PipelineJobOut)
async def add_entry(
    body: AddIn, session: AsyncSession = Depends(get_db)
) -> PipelineJobOut:
    entry = await add_to_pipeline(session, body.job_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="job not found")
    row = await get_pipeline_entry(session, body.job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return _flatten(*row)


@router.patch("/pipeline/{job_id}", response_model=PipelineJobOut)
async def update_entry(
    job_id: str, body: UpdateIn, session: AsyncSession = Depends(get_db)
) -> PipelineJobOut:
    try:
        entry = await update_pipeline_entry(
            session,
            job_id,
            stage=body.stage,
            outcome=body.outcome,
            notes=body.notes,
            contact_email=body.contact_email,
            clear_outcome=body.clear_outcome,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if entry is None:
        raise HTTPException(status_code=404, detail="not in pipeline")
    row = await get_pipeline_entry(session, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not in pipeline")
    return _flatten(*row)


@router.delete("/pipeline/{job_id}")
async def delete_entry(job_id: str, session: AsyncSession = Depends(get_db)) -> dict:
    removed = await remove_from_pipeline(session, job_id)
    if not removed:
        raise HTTPException(status_code=404, detail="not in pipeline")
    return {"ok": True}
