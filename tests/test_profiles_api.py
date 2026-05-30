# tests/test_profiles_api.py
from __future__ import annotations

import pathlib
import tempfile
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.app import app
from api.deps import get_db
from storage.models import Base, Resume, ResumeSection


@pytest.fixture
async def client(tmp_path, monkeypatch):
    import api.routers.resumes as resumes_mod
    monkeypatch.setattr(resumes_mod, "UPLOADS_DIR", tmp_path)

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


@pytest.fixture
async def resume_id(client):
    resp = await client.post(
        "/api/resumes",
        files={"file": ("cv.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_get_profile_404_before_generate(client):
    resp = await client.get("/api/profile/nonexistent-id")
    assert resp.status_code == 404


async def test_generate_profile_404_for_unknown_resume(client):
    resp = await client.post("/api/profile/nonexistent-id/generate")
    assert resp.status_code == 404


async def test_generate_then_get_profile(client, resume_id):
    gen = await client.post(f"/api/profile/{resume_id}/generate")
    assert gen.status_code == 200

    resp = await client.get(f"/api/profile/{resume_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["resume_id"] == resume_id
    assert "first_name" in data
    assert isinstance(data["experience"], list)
    assert isinstance(data["education"], list)


async def test_put_profile_updates_fields(client, resume_id):
    await client.post(f"/api/profile/{resume_id}/generate")

    payload = {
        "first_name": "Jane",
        "last_name": "Smith",
        "email": "jane@example.com",
        "phone": "415-555-0100",
        "linkedin_url": None,
        "location": "SF, CA",
        "work_auth": "US Citizen",
        "experience": [],
        "education": [],
    }
    resp = await client.put(f"/api/profile/{resume_id}", json=payload)
    assert resp.status_code == 200

    fetched = await client.get(f"/api/profile/{resume_id}")
    assert fetched.json()["first_name"] == "Jane"
    assert fetched.json()["work_auth"] == "US Citizen"
