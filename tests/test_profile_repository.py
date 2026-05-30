import pytest
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from storage.models import Resume, ResumeSection
from storage.repository import generate_profile_from_resume, get_profile, save_profile
from storage.models import Profile, ProfileExperience, ProfileEducation


async def _seed_resume(session: AsyncSession, resume_id: str) -> None:
    now = datetime.now(tz=timezone.utc)
    session.add(Resume(
        id=resume_id,
        filename="test.pdf",
        file_path="/tmp/test.pdf",
        uploaded_at=now,
    ))
    session.add(ResumeSection(
        resume_id=resume_id,
        section_type="contact",
        content="Jane Smith\njane@example.com\n(415) 555-0100\nSan Francisco, CA",
    ))
    session.add(ResumeSection(
        resume_id=resume_id,
        section_type="experience",
        content="Engineer\nAcme Corp\n2022 – Present\nBuilt things",
    ))
    session.add(ResumeSection(
        resume_id=resume_id,
        section_type="education",
        content="UC Berkeley\nBachelor of Science in CS\nGPA: 3.8 | 2022",
    ))
    await session.commit()


async def test_get_profile_returns_none_when_missing(db_session):
    result = await get_profile(db_session, "nonexistent")
    assert result is None


async def test_generate_profile_creates_profile(db_session):
    await _seed_resume(db_session, "r1")
    profile = await generate_profile_from_resume(db_session, "r1")
    assert profile.email == "jane@example.com"
    assert profile.first_name == "Jane"


async def test_generate_profile_creates_experience(db_session):
    await _seed_resume(db_session, "r2")
    await generate_profile_from_resume(db_session, "r2")
    from sqlalchemy import select
    rows = (await db_session.execute(
        select(ProfileExperience).where(ProfileExperience.profile_id == "r2")
    )).scalars().all()
    assert len(rows) >= 1
    assert rows[0].is_current is True


async def test_generate_profile_creates_education(db_session):
    await _seed_resume(db_session, "r3")
    await generate_profile_from_resume(db_session, "r3")
    from sqlalchemy import select
    rows = (await db_session.execute(
        select(ProfileEducation).where(ProfileEducation.profile_id == "r3")
    )).scalars().all()
    assert len(rows) >= 1
    assert rows[0].institution == "UC Berkeley"


async def test_save_profile_replaces_existing(db_session):
    await _seed_resume(db_session, "r4")
    await generate_profile_from_resume(db_session, "r4")

    now = datetime.now(tz=timezone.utc)
    updated = Profile(
        id="r4", first_name="Updated", last_name="Name",
        email="new@example.com", created_at=now, updated_at=now,
    )
    await save_profile(db_session, updated, [], [])
    fetched = await get_profile(db_session, "r4")
    assert fetched.first_name == "Updated"
