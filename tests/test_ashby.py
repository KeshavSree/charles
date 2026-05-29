# tests/test_ashby.py
import pytest
import httpx
from pytest_httpx import HTTPXMock
from datetime import datetime, timezone

from scrapers.ashby import AshbyScraper
from scrapers.registry import SCRAPER_REGISTRY

SAMPLE_RESPONSE = {
    "jobs": [
        {
            "id": "uuid-anthropic-001",
            "title": "Research Engineer",
            "location": "San Francisco, CA",
            "descriptionHtml": "<p>Join our research team.</p>",
            "publishedAt": "2024-01-15T10:00:00Z",
            "jobUrl": "https://jobs.ashbyhq.com/anthropic/uuid-anthropic-001",
        },
        {
            "id": "uuid-anthropic-002",
            "title": "Policy Researcher",
            "location": "Remote",
            "descriptionHtml": "<p>Work on AI policy.</p>",
            "publishedAt": "2024-02-01T09:30:00Z",
            "jobUrl": "https://jobs.ashbyhq.com/anthropic/uuid-anthropic-002",
        },
    ]
}


@pytest.mark.asyncio
async def test_ashby_scrape_returns_job_postings(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.ashbyhq.com/posting-api/job-board/anthropic",
        json=SAMPLE_RESPONSE,
    )
    async with httpx.AsyncClient() as client:
        jobs = await AshbyScraper(client).scrape("anthropic")

    assert len(jobs) == 2
    assert jobs[0].source == "ashby"
    assert jobs[0].company == "anthropic"
    assert jobs[0].title == "Research Engineer"
    assert jobs[0].url == "https://jobs.ashbyhq.com/anthropic/uuid-anthropic-001"
    assert jobs[0].location == "San Francisco, CA"
    assert jobs[0].description == "Join our research team."
    assert jobs[0].id == "uuid-anthropic-001"
    assert jobs[0].posted_at == datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_ashby_empty_response(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.ashbyhq.com/posting-api/job-board/cohere",
        json={"jobs": []},
    )
    async with httpx.AsyncClient() as client:
        jobs = await AshbyScraper(client).scrape("cohere")
    assert jobs == []


@pytest.mark.asyncio
async def test_ashby_http_error_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.ashbyhq.com/posting-api/job-board/unknown",
        status_code=404,
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await AshbyScraper(client).scrape("unknown")


def test_ashby_is_registered():
    assert "ashby" in SCRAPER_REGISTRY
    assert SCRAPER_REGISTRY["ashby"] is AshbyScraper
