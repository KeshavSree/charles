# tests/test_base.py
import inspect
import pytest
from datetime import datetime, timezone
from scrapers.base import JobPosting, BaseScraper


def test_job_posting_required_fields():
    job = JobPosting(
        id="abc123",
        source="greenhouse",
        company="stripe",
        title="Software Engineer",
        url="https://boards.greenhouse.io/stripe/jobs/123",
    )
    assert job.id == "abc123"
    assert job.location is None
    assert job.description is None
    assert job.posted_at is None


def test_job_posting_full_fields():
    now = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
    job = JobPosting(
        id="def456",
        source="lever",
        company="vercel",
        title="Frontend Engineer",
        url="https://jobs.lever.co/vercel/uuid",
        location="Remote",
        description="<p>Job description</p>",
        posted_at=now,
    )
    assert job.location == "Remote"
    assert job.posted_at == now


def test_job_posting_id_is_coerced_to_str():
    # Greenhouse returns integer IDs
    job = JobPosting(
        id=99999,
        source="greenhouse",
        company="notion",
        title="PM",
        url="https://boards.greenhouse.io/notion/jobs/99999",
    )
    assert isinstance(job.id, str)
    assert job.id == "99999"


def test_base_scraper_is_abstract():
    assert inspect.isabstract(BaseScraper)


def test_base_scraper_requires_playwright_default():
    assert BaseScraper.requires_playwright is False
