"""The run/progress/cancel endpoints.

The contract these pin: starting a scan returns immediately with an id, the run's
state is readable by anyone at any time, and a second start attaches to the run
already going instead of launching a competing one.
"""
from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.app import app
from api.deps import get_db
from scanner import progress
from storage.models import Base


@pytest.fixture
async def client(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override() -> AsyncSession:
        async with factory() as session:
            yield session

    # start_run opens its own session, since the request that starts a run is gone
    # long before the run ends.
    import scanner.service as service
    monkeypatch.setattr("storage.db.get_session", lambda: factory(), raising=False)

    app.dependency_overrides[get_db] = override
    progress.reset()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    progress.reset()
    await engine.dispose()


async def test_progress_is_idle_before_anything_runs(client):
    body = (await client.get("/api/scanner/progress")).json()
    assert body["active"] is False
    assert body["status"] == "idle"


async def test_unknown_source_is_rejected_before_a_run_starts(client):
    resp = await client.post("/api/scanner/run", json={"source_id": "nope"})
    assert resp.status_code == 404
    assert progress.snapshot()["active"] is False


async def test_run_without_a_source_or_all_is_a_bad_request(client):
    assert (await client.post("/api/scanner/run", json={})).status_code == 400


async def test_cancel_with_nothing_running_is_not_an_error(client):
    resp = await client.post("/api/scanner/cancel")
    assert resp.status_code == 200
    assert resp.json()["cancelled"] is False


async def test_starting_a_run_returns_202_immediately_with_an_id(client, monkeypatch):
    """The response must not wait for the sweep; that coupling is what let a proxy
    timeout convince the UI a running scan had failed."""
    started = asyncio.Event()

    async def slow_scan_all(session, **_):
        started.set()
        await asyncio.sleep(30)          # far longer than the request may take
        return []

    monkeypatch.setattr("scanner.service.scan_all", slow_scan_all)
    monkeypatch.setattr("scanner.service.enabled_source_ids",
                        lambda session: _ids())

    resp = await asyncio.wait_for(
        client.post("/api/scanner/run", json={"all": True}), timeout=5
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["started"] is True and body["run_id"]

    await asyncio.wait_for(started.wait(), timeout=5)
    assert (await client.get("/api/scanner/progress")).json()["active"] is True

    await client.post("/api/scanner/cancel")


async def test_a_second_start_attaches_to_the_run_already_going(client, monkeypatch):
    async def slow_scan_all(session, **_):
        await asyncio.sleep(30)
        return []

    monkeypatch.setattr("scanner.service.scan_all", slow_scan_all)
    monkeypatch.setattr("scanner.service.enabled_source_ids", lambda session: _ids())

    first = (await client.post("/api/scanner/run", json={"all": True})).json()
    second = (await client.post("/api/scanner/run", json={"all": True})).json()

    assert second["started"] is False
    assert second["reason"] == "already_running"
    # Crucially it reports the *existing* run, so the UI shows that one rather than
    # believing it launched something new.
    assert second["run_id"] == first["run_id"]

    await client.post("/api/scanner/cancel")


async def test_cancel_stops_the_run_and_records_it(client, monkeypatch):
    async def slow_scan_all(session, **_):
        await asyncio.sleep(30)
        return []

    monkeypatch.setattr("scanner.service.scan_all", slow_scan_all)
    monkeypatch.setattr("scanner.service.enabled_source_ids", lambda session: _ids())

    await client.post("/api/scanner/run", json={"all": True})
    resp = await client.post("/api/scanner/cancel")
    body = resp.json()

    assert body["cancelled"] is True
    assert body["active"] is False
    assert body["status"] == "cancelled"


async def test_state_outlives_the_request_that_started_it(client, monkeypatch):
    """A reload is just another reader: the run it sees is the one on the server."""
    async def quick_scan_all(session, **_):
        progress.begin_stage("remoteok")
        progress.set_counts(10, 3)
        progress.end_stage("remoteok", added=3)
        return []

    monkeypatch.setattr("scanner.service.scan_all", quick_scan_all)
    monkeypatch.setattr("scanner.service.enabled_source_ids", lambda session: _ids())

    await client.post("/api/scanner/run", json={"all": True})
    for _ in range(50):
        await asyncio.sleep(0.02)
        if not (await client.get("/api/scanner/progress")).json()["active"]:
            break

    body = (await client.get("/api/scanner/progress")).json()
    assert body["active"] is False
    assert body["status"] == "completed"
    assert body["added"] == 3


async def _ids():
    return ["remoteok"]


async def test_a_scheduled_scan_uses_the_same_tracker(client, monkeypatch):
    """A timed sweep that bypassed the tracker would be invisible to the UI and could
    overlap a manual one -- the exact condition that produced shared counters."""
    from scanner import service

    seen = {}

    async def scan_all_stub(session, **_):
        seen["active_during"] = progress.is_active()
        return []

    monkeypatch.setattr("scanner.service.scan_all", scan_all_stub)
    monkeypatch.setattr("scanner.service.enabled_source_ids", lambda session: _ids())

    await service.run_scheduled_scan()
    assert seen["active_during"] is True
    assert progress.snapshot()["status"] == "completed"


async def test_a_scheduled_scan_defers_to_a_run_already_going(client, monkeypatch):
    from scanner import service

    async def slow_scan_all(session, **_):
        await asyncio.sleep(30)
        return []

    monkeypatch.setattr("scanner.service.scan_all", slow_scan_all)
    monkeypatch.setattr("scanner.service.enabled_source_ids", lambda session: _ids())

    started = (await client.post("/api/scanner/run", json={"all": True})).json()
    await service.run_scheduled_scan()          # must not start a second sweep
    assert progress.snapshot()["run_id"] == started["run_id"]

    await client.post("/api/scanner/cancel")
