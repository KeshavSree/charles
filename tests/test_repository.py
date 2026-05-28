# tests/test_repository.py
import hashlib
import pytest
from datetime import datetime, timezone

from scrapers.base import JobPosting
from storage.repository import upsert_jobs, query_jobs


def _make_job(
    title: str,
    url: str,
    company: str = "stripe",
    source: str = "greenhouse",
) -> JobPosting:
    return JobPosting(
        id="123",
        source=source,
        company=company,
        title=title,
        url=url,
        location="Remote",
        description="<p>Description</p>",
        posted_at=datetime(2024, 1, 15, tzinfo=timezone.utc),
    )


@pytest.mark.asyncio
async def test_upsert_jobs_inserts_new_jobs(db_session):
    jobs = [
        _make_job("SWE", "https://example.com/job/1"),
        _make_job("PM", "https://example.com/job/2"),
    ]
    await upsert_jobs(db_session, jobs)
    results = await query_jobs(db_session)
    assert len(results) == 2


@pytest.mark.asyncio
async def test_upsert_jobs_deduplicates_same_url(db_session):
    await upsert_jobs(db_session, [_make_job("SWE", "https://example.com/job/1")])
    await upsert_jobs(db_session, [_make_job("SWE v2", "https://example.com/job/1")])
    results = await query_jobs(db_session)
    assert len(results) == 1
    assert results[0].title == "SWE v2"


@pytest.mark.asyncio
async def test_upsert_jobs_id_is_sha256_of_url(db_session):
    url = "https://example.com/job/42"
    await upsert_jobs(db_session, [_make_job("Engineer", url)])
    results = await query_jobs(db_session)
    expected_id = hashlib.sha256(url.encode()).hexdigest()[:16]
    assert results[0].id == expected_id


@pytest.mark.asyncio
async def test_query_jobs_filter_by_company(db_session):
    await upsert_jobs(db_session, [
        _make_job("SWE", "https://example.com/job/1", company="stripe"),
        _make_job("PM", "https://example.com/job/2", company="notion"),
    ])
    results = await query_jobs(db_session, company="stripe")
    assert len(results) == 1
    assert results[0].company == "stripe"


@pytest.mark.asyncio
async def test_query_jobs_filter_by_source(db_session):
    await upsert_jobs(db_session, [
        _make_job("SWE", "https://example.com/job/1", source="greenhouse"),
        _make_job("PM", "https://example.com/job/2", source="lever"),
    ])
    results = await query_jobs(db_session, source="lever")
    assert len(results) == 1
    assert results[0].source == "lever"


@pytest.mark.asyncio
async def test_query_jobs_no_filter_returns_all(db_session):
    await upsert_jobs(db_session, [
        _make_job("A", "https://example.com/job/1"),
        _make_job("B", "https://example.com/job/2"),
        _make_job("C", "https://example.com/job/3"),
    ])
    results = await query_jobs(db_session)
    assert len(results) == 3
