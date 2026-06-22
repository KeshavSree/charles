# api/routers/profiles.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import Profile, ProfileExperience, ProfileEducation, Resume
from storage.repository import get_profile, generate_profile_from_resume

router = APIRouter()


class ExperienceOut(BaseModel):
    id: int | None = None
    company: str
    title: str
    location: str | None = None
    start_date: str | None
    end_date: str | None
    is_current: bool
    description: str | None
    display_order: int

    model_config = {"from_attributes": True}


class EducationOut(BaseModel):
    id: int | None = None
    institution: str
    degree: str | None
    major: str | None
    gpa: str | None
    grad_year: str | None
    grad_month: str | None = None
    display_order: int

    model_config = {"from_attributes": True}


class ProfileOut(BaseModel):
    resume_id: str
    first_name: str
    last_name: str
    email: str
    phone: str | None
    linkedin_url: str | None
    location: str | None
    work_auth: str | None
    experience: list[ExperienceOut]
    education: list[EducationOut]


class ExperienceIn(BaseModel):
    company: str = ""
    title: str = ""
    location: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    is_current: bool = False
    description: str | None = None
    display_order: int = 0


class EducationIn(BaseModel):
    institution: str = ""
    degree: str | None = None
    major: str | None = None
    gpa: str | None = None
    grad_year: str | None = None
    grad_month: str | None = None
    display_order: int = 0


class ProfileIn(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str | None = None
    linkedin_url: str | None = None
    location: str | None = None
    work_auth: str | None = None
    experience: list[ExperienceIn] = []
    education: list[EducationIn] = []


async def _load_profile_out(session: AsyncSession, resume_id: str) -> ProfileOut:
    profile = await get_profile(session, resume_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    exp_rows = (await session.execute(
        select(ProfileExperience)
        .where(ProfileExperience.profile_id == resume_id)
        .order_by(ProfileExperience.display_order)
    )).scalars().all()
    edu_rows = (await session.execute(
        select(ProfileEducation)
        .where(ProfileEducation.profile_id == resume_id)
        .order_by(ProfileEducation.display_order)
    )).scalars().all()
    return ProfileOut(
        resume_id=resume_id,
        first_name=profile.first_name,
        last_name=profile.last_name,
        email=profile.email,
        phone=profile.phone,
        linkedin_url=profile.linkedin_url,
        location=profile.location,
        work_auth=profile.work_auth,
        experience=[ExperienceOut.model_validate(e) for e in exp_rows],
        education=[EducationOut.model_validate(e) for e in edu_rows],
    )


@router.get("/profile/{resume_id}", response_model=ProfileOut)
async def get_profile_endpoint(
    resume_id: str, session: AsyncSession = Depends(get_db)
) -> ProfileOut:
    return await _load_profile_out(session, resume_id)


@router.put("/profile/{resume_id}", response_model=ProfileOut)
async def update_profile(
    resume_id: str,
    body: ProfileIn,
    session: AsyncSession = Depends(get_db),
) -> ProfileOut:
    existing = await get_profile(session, resume_id)
    now = datetime.now(tz=timezone.utc)
    if existing:
        profile = existing
        profile.first_name = body.first_name
        profile.last_name = body.last_name
        profile.email = body.email
        profile.phone = body.phone
        profile.linkedin_url = body.linkedin_url
        profile.location = body.location
        profile.work_auth = body.work_auth
        profile.updated_at = now
    else:
        resume = await session.get(Resume, resume_id)
        if not resume:
            raise HTTPException(status_code=404, detail="Resume not found")
        profile = Profile(
            id=resume_id,
            first_name=body.first_name,
            last_name=body.last_name,
            email=body.email,
            phone=body.phone,
            linkedin_url=body.linkedin_url,
            location=body.location,
            work_auth=body.work_auth,
            created_at=now,
            updated_at=now,
        )
        session.add(profile)

    await session.flush()
    await session.execute(
        delete(ProfileExperience).where(ProfileExperience.profile_id == resume_id)
    )
    await session.execute(
        delete(ProfileEducation).where(ProfileEducation.profile_id == resume_id)
    )
    for i, e in enumerate(body.experience):
        session.add(ProfileExperience(
            profile_id=resume_id, company=e.company, title=e.title, location=e.location,
            start_date=e.start_date, end_date=e.end_date, is_current=e.is_current,
            description=e.description, display_order=i,
        ))
    for i, e in enumerate(body.education):
        session.add(ProfileEducation(
            profile_id=resume_id, institution=e.institution, degree=e.degree,
            major=e.major, gpa=e.gpa, grad_year=e.grad_year, grad_month=e.grad_month,
            display_order=i,
        ))
    await session.commit()
    return await _load_profile_out(session, resume_id)


@router.post("/profile/{resume_id}/generate", response_model=ProfileOut)
async def generate_profile(
    resume_id: str, session: AsyncSession = Depends(get_db)
) -> ProfileOut:
    resume = await session.get(Resume, resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    await generate_profile_from_resume(session, resume_id)
    return await _load_profile_out(session, resume_id)
