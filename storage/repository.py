# storage/repository.py
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

_log = logging.getLogger(__name__)

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from scrapers.base import JobPosting
from storage.models import Job, Profile, ProfileExperience, ProfileEducation, Resume, ResumeSection, UserInfo


def _url_to_id(url: str) -> str:
    """Return first 16 hex chars of SHA256(url)."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _dialect_name(session: AsyncSession) -> str:
    """Detect DB dialect from the session's engine URL."""
    sync_session = session.sync_session
    bind = sync_session.get_bind()
    return "postgresql" if "postgresql" in str(bind.url) else "sqlite"


async def upsert_jobs(session: AsyncSession, postings: list[JobPosting]) -> None:
    """Insert or update job rows. Deduplication key: SHA256(url)[:16].

    Works with both SQLite (dev) and PostgreSQL (prod).
    """
    if not postings:
        return

    now = datetime.now(tz=timezone.utc)
    rows = [
        {
            "id": _url_to_id(p.url),
            "source": p.source,
            "company": p.company,
            "title": p.title,
            "url": p.url,
            "location": p.location,
            "description": p.description,
            "posted_at": p.posted_at,
            "updated_at": p.updated_at,
            "seniority": p.seniority,
            "scraped_at": now,
        }
        for p in postings
    ]

    dialect = _dialect_name(session)

    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(Job).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={
                "title": stmt.excluded.title,
                "location": stmt.excluded.location,
                "description": stmt.excluded.description,
                "updated_at": stmt.excluded.updated_at,
                "seniority": stmt.excluded.seniority,
                "scraped_at": stmt.excluded.scraped_at,
            },
        )
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stmt = sqlite_insert(Job).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={
                "title": stmt.excluded.title,
                "location": stmt.excluded.location,
                "description": stmt.excluded.description,
                "updated_at": stmt.excluded.updated_at,
                "seniority": stmt.excluded.seniority,
                "scraped_at": stmt.excluded.scraped_at,
            },
        )

    await session.execute(stmt)
    await session.commit()


async def query_jobs(
    session: AsyncSession,
    *,
    company: Optional[str] = None,
    source: Optional[str] = None,
) -> list[Job]:
    """Query persisted jobs with optional filters."""
    stmt = select(Job)
    if company is not None:
        stmt = stmt.where(Job.company == company)
    if source is not None:
        stmt = stmt.where(Job.source == source)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_profile(session: AsyncSession, resume_id: str) -> Profile | None:
    return await session.get(Profile, resume_id)


async def save_profile(
    session: AsyncSession,
    profile: Profile,
    experience: list[ProfileExperience],
    education: list[ProfileEducation],
) -> None:
    await session.execute(
        delete(ProfileExperience).where(ProfileExperience.profile_id == profile.id)
    )
    await session.execute(
        delete(ProfileEducation).where(ProfileEducation.profile_id == profile.id)
    )
    existing = await session.get(Profile, profile.id)
    if existing:
        existing.first_name = profile.first_name
        existing.last_name = profile.last_name
        existing.email = profile.email
        existing.phone = profile.phone
        existing.linkedin_url = profile.linkedin_url
        existing.location = profile.location
        existing.work_auth = profile.work_auth
        existing.updated_at = profile.updated_at
    else:
        session.add(profile)
    await session.flush()
    for exp in experience:
        session.add(exp)
    for edu in education:
        session.add(edu)
    await session.commit()


async def generate_profile_from_resume(session: AsyncSession, resume_id: str) -> Profile:
    from parser.contact import extract_contact
    from parser.experience import extract_experience
    from parser.education import extract_education

    sections_result = await session.execute(
        select(ResumeSection).where(ResumeSection.resume_id == resume_id)
    )
    sections: dict[str, str] = {
        s.section_type: s.content for s in sections_result.scalars().all()
    }

    resume = await session.get(Resume, resume_id)
    full_text = sections.get("contact", "") + "\n" + "\n".join(
        v for k, v in sections.items() if k != "contact"
    )
    if resume and resume.file_path:
        try:
            from parser.pdf import extract_text
            full_text = extract_text(resume.file_path)
        except Exception:
            _log.warning("PDF extraction failed for %s", resume.file_path if resume else resume_id, exc_info=True)

    contact = extract_contact(full_text, sections.get("contact", ""))
    exp_entries = extract_experience(sections.get("experience", ""))
    edu_entries = extract_education(sections.get("education", ""))

    now = datetime.now(tz=timezone.utc)
    existing = await session.get(Profile, resume_id)
    if existing:
        existing.first_name = contact.first_name
        existing.last_name = contact.last_name
        existing.email = contact.email
        existing.phone = contact.phone or None
        existing.linkedin_url = contact.linkedin_url or None
        existing.location = contact.location or None
        existing.updated_at = now
        profile = existing
    else:
        profile = Profile(
            id=resume_id,
            first_name=contact.first_name,
            last_name=contact.last_name,
            email=contact.email,
            phone=contact.phone or None,
            linkedin_url=contact.linkedin_url or None,
            location=contact.location or None,
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

    for i, e in enumerate(exp_entries):
        session.add(ProfileExperience(
            profile_id=resume_id,
            company=e.company,
            title=e.title,
            start_date=e.start_date or None,
            end_date=e.end_date or None,
            is_current=e.is_current,
            description=e.description or None,
            display_order=i,
        ))

    for i, e in enumerate(edu_entries):
        session.add(ProfileEducation(
            profile_id=resume_id,
            institution=e.institution,
            degree=e.degree or None,
            major=e.major or None,
            gpa=e.gpa or None,
            grad_year=e.grad_year or None,
            display_order=i,
        ))

    await session.commit()
    return profile


_INFO_ID = "default"


async def get_or_create_info(session: AsyncSession) -> UserInfo:
    row = await session.get(UserInfo, _INFO_ID)
    if row is None:
        row = UserInfo(id=_INFO_ID, updated_at=datetime.now(tz=timezone.utc))
        session.add(row)
        await session.commit()
    return row


_INFO_SKIP = frozenset({'id', 'updated_at', 'work_auth'})


async def save_info(session: AsyncSession, data: UserInfo) -> UserInfo:
    existing = await session.get(UserInfo, _INFO_ID)
    now = datetime.now(tz=timezone.utc)
    if existing:
        for attr in UserInfo.__mapper__.column_attrs:
            if attr.key not in _INFO_SKIP:
                setattr(existing, attr.key, getattr(data, attr.key, None))
        existing.updated_at = now
    else:
        data.id = _INFO_ID
        data.updated_at = now
        session.add(data)
    await session.commit()
    return await session.get(UserInfo, _INFO_ID)
