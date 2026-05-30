# tests/test_resume_models.py
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from storage.models import Base, Resume, ResumeSection
from datetime import datetime, timezone
import uuid

@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()

async def test_resume_and_sections_persist(session):
    resume_id = str(uuid.uuid4())
    resume = Resume(
        id=resume_id,
        filename="cv.pdf",
        file_path="/uploads/cv.pdf",
        uploaded_at=datetime.now(tz=timezone.utc),
    )
    section = ResumeSection(resume_id=resume_id, section_type="skills", content="Python, Go")
    session.add(resume)
    session.add(section)
    await session.commit()

    from sqlalchemy import select
    r = (await session.execute(select(Resume).where(Resume.id == resume_id))).scalar_one()
    assert r.filename == "cv.pdf"
    s = (await session.execute(select(ResumeSection).where(ResumeSection.resume_id == resume_id))).scalar_one()
    assert s.section_type == "skills"
    assert s.content == "Python, Go"


async def test_profile_tables_exist(db_session):
    from storage.models import Profile, ProfileExperience, ProfileEducation
    from datetime import datetime, timezone
    now = datetime.now(tz=timezone.utc)
    profile = Profile(
        id="test-resume-id",
        first_name="Jane",
        last_name="Smith",
        email="jane@example.com",
        created_at=now,
        updated_at=now,
    )
    db_session.add(profile)
    await db_session.flush()

    exp = ProfileExperience(
        profile_id="test-resume-id",
        company="Acme",
        title="Engineer",
        display_order=0,
        is_current=False,
    )
    db_session.add(exp)

    edu = ProfileEducation(
        profile_id="test-resume-id",
        institution="UC Berkeley",
        display_order=0,
    )
    db_session.add(edu)
    await db_session.commit()

    from sqlalchemy import select
    result = await db_session.execute(select(Profile))
    assert result.scalar_one().email == "jane@example.com"
