from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.app import app
from api.deps import get_db
from storage.models import Base


@pytest.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override() -> AsyncSession:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


async def test_get_info_creates_empty_singleton(client):
    resp = await client.get("/api/info")
    assert resp.status_code == 200
    data = resp.json()
    assert data["first_name"] == ""
    assert data["email"] == ""
    assert data["phone"] is None


async def test_get_info_twice_returns_same_row(client):
    r1 = await client.get("/api/info")
    r2 = await client.get("/api/info")
    # Both calls return the same singleton — email unchanged
    assert r1.json()["email"] == r2.json()["email"] == ""


async def test_put_info_updates_fields(client):
    payload = {
        "first_name": "Jane",
        "last_name": "Smith",
        "email": "jane@example.com",
        "phone": "415-555-0100",
        "linkedin_url": None,
        "location": "San Francisco, CA",
        "work_auth": "US Citizen",
    }
    resp = await client.put("/api/info", json=payload)
    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Jane"
    assert resp.json()["work_auth"] == "US Citizen"


async def test_get_after_put_reflects_update(client):
    await client.put("/api/info", json={
        "first_name": "Jane", "last_name": "Smith", "email": "jane@example.com",
        "phone": None, "linkedin_url": None, "location": None, "work_auth": None,
    })
    resp = await client.get("/api/info")
    assert resp.json()["first_name"] == "Jane"


async def test_put_info_boolean_fields(client):
    payload = {
        "first_name": "", "last_name": "", "email": "",
        "phone": None, "linkedin_url": None,
        "address": None, "city": None, "state": None,
        "zip_code": None, "country": None, "work_auth": None,
        "work_authorized": True,
        "requires_sponsorship": False,
        "gender": "Male",
        "ethnicity": "Asian",
        "veteran_status": "I am not a protected veteran",
        "disability_status": "I do not have a disability",
    }
    resp = await client.put("/api/info", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["work_authorized"] is True
    assert data["requires_sponsorship"] is False
    assert data["gender"] == "Male"
    assert data["veteran_status"] == "I am not a protected veteran"


async def test_put_info_null_booleans_preserved(client):
    payload = {
        "first_name": "", "last_name": "", "email": "",
        "phone": None, "linkedin_url": None,
        "address": None, "city": None, "state": None,
        "zip_code": None, "country": None, "work_auth": None,
        "work_authorized": None, "requires_sponsorship": None,
        "gender": None, "ethnicity": None,
        "veteran_status": None, "disability_status": None,
    }
    resp = await client.put("/api/info", json=payload)
    assert resp.status_code == 200
    assert resp.json()["work_authorized"] is None
    assert resp.json()["gender"] is None
