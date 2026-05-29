# tests/test_jobs_api.py
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.app import app
from api.deps import get_db
from storage.models import Base, Job


def _make_engine():
    return create_async_engine("sqlite+aiosqlite:///:memory:")


@pytest.fixture
async def client():
    engine = _make_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override() -> AsyncSession:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, factory
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


async def test_list_jobs_empty(client):
    c, _ = client
    resp = await c.get("/api/jobs")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_jobs_returns_job(client):
    c, factory = client
    async with factory() as session:
        session.add(Job(
            id="abc12345678901ab",
            source="greenhouse",
            company="netflix",
            title="Software Engineer",
            url="https://example.com/job/1",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        await session.commit()

    resp = await c.get("/api/jobs")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["title"] == "Software Engineer"
    assert data[0]["company"] == "netflix"


async def test_search_filter_matches(client):
    c, factory = client
    async with factory() as session:
        session.add(Job(
            id="aaa1234567890111",
            source="ashby",
            company="anthropic",
            title="ML Research Engineer",
            url="https://example.com/job/2",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        session.add(Job(
            id="bbb1234567890222",
            source="ashby",
            company="anthropic",
            title="Office Manager",
            url="https://example.com/job/3",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        await session.commit()

    resp = await c.get("/api/jobs?search=engineer")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert "Engineer" in data[0]["title"]


async def test_get_filters(client):
    c, _ = client
    resp = await c.get("/api/jobs/filters")
    assert resp.status_code == 200
    data = resp.json()
    assert "companies" in data
    assert "sources" in data
    assert isinstance(data["companies"], list)


async def test_get_filters_populated(client):
    c, factory = client
    async with factory() as session:
        session.add(Job(
            id="fil1234567890001",
            source="greenhouse",
            company="acme",
            title="Backend Engineer",
            url="https://example.com/job/f1",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        session.add(Job(
            id="fil1234567890002",
            source="ashby",
            company="globex",
            title="Data Scientist",
            url="https://example.com/job/f2",
            seniority="intern",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        await session.commit()

    resp = await c.get("/api/jobs/filters")
    assert resp.status_code == 200
    data = resp.json()
    assert "acme" in data["companies"]
    assert "globex" in data["companies"]
    assert "greenhouse" in data["sources"]
    assert "ashby" in data["sources"]


async def test_company_filter(client):
    c, factory = client
    async with factory() as session:
        session.add(Job(
            id="cmp1234567890001",
            source="greenhouse",
            company="acme",
            title="Frontend Engineer",
            url="https://example.com/job/c1",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        session.add(Job(
            id="cmp1234567890002",
            source="greenhouse",
            company="initech",
            title="Backend Engineer",
            url="https://example.com/job/c2",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        await session.commit()

    resp = await c.get("/api/jobs?company=acme")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["company"] == "acme"


async def test_seniority_filter(client):
    c, factory = client
    async with factory() as session:
        session.add(Job(
            id="sen1234567890001",
            source="ashby",
            company="hooli",
            title="Software Engineer Intern",
            url="https://example.com/job/s1",
            seniority="intern",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        session.add(Job(
            id="sen1234567890002",
            source="ashby",
            company="hooli",
            title="Senior Software Engineer",
            url="https://example.com/job/s2",
            seniority="full_time",
            scraped_at=datetime.now(tz=timezone.utc),
        ))
        await session.commit()

    resp = await c.get("/api/jobs?seniority=intern")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["seniority"] == "intern"
