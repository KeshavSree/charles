# tests/test_resumes_api.py
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.app import app
from api.deps import get_db
from storage.models import Base


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


async def test_list_resumes_empty(client):
    resp = await client.get("/api/resumes")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_upload_non_pdf_rejected(client):
    resp = await client.post(
        "/api/resumes",
        files={"file": ("test.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400


async def test_upload_pdf_creates_resume(client):
    resp = await client.post(
        "/api/resumes",
        files={"file": ("my_cv.pdf", b"%PDF-1.4 fake content", "application/pdf")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data

    list_resp = await client.get("/api/resumes")
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["filename"] == "my_cv.pdf"
    assert list_resp.json()[0]["section_count"] == 0


async def test_get_resume_not_found(client):
    resp = await client.get("/api/resumes/nonexistent-id")
    assert resp.status_code == 404


async def test_delete_resume(client):
    upload = await client.post(
        "/api/resumes",
        files={"file": ("cv.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    resume_id = upload.json()["id"]

    del_resp = await client.delete(f"/api/resumes/{resume_id}")
    assert del_resp.status_code == 204

    list_resp = await client.get("/api/resumes")
    assert list_resp.json() == []


async def test_delete_resume_not_found(client):
    resp = await client.delete("/api/resumes/nonexistent-id")
    assert resp.status_code == 404
