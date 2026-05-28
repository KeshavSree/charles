# tests/test_greenhouse.py
import pytest
import httpx
from pytest_httpx import HTTPXMock

from scrapers.greenhouse import GreenhouseScraper
from scrapers.registry import SCRAPER_REGISTRY

SAMPLE_RESPONSE = {
    "jobs": [
        {
            "id": 4567890,
            "title": "Software Engineer, Backend",
            "absolute_url": "https://boards.greenhouse.io/stripe/jobs/4567890",
            "content": "<p>We are looking for...</p>",
            "location": {"name": "Remote - US"},
        },
        {
            "id": 4567891,
            "title": "Staff Engineer",
            "absolute_url": "https://boards.greenhouse.io/stripe/jobs/4567891",
            "content": "<p>Staff role...</p>",
            "location": {"name": "San Francisco, CA"},
        },
    ]
}


@pytest.mark.asyncio
async def test_greenhouse_scrape_returns_job_postings(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
        json=SAMPLE_RESPONSE,
    )
    async with httpx.AsyncClient() as client:
        scraper = GreenhouseScraper(client)
        jobs = await scraper.scrape("stripe")

    assert len(jobs) == 2
    assert jobs[0].source == "greenhouse"
    assert jobs[0].company == "stripe"
    assert jobs[0].title == "Software Engineer, Backend"
    assert jobs[0].url == "https://boards.greenhouse.io/stripe/jobs/4567890"
    assert jobs[0].location == "Remote - US"
    assert jobs[0].description == "<p>We are looking for...</p>"
    assert jobs[0].id == "4567890"
    assert jobs[0].posted_at is None


@pytest.mark.asyncio
async def test_greenhouse_empty_response(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://boards-api.greenhouse.io/v1/boards/notion/jobs?content=true",
        json={"jobs": []},
    )
    async with httpx.AsyncClient() as client:
        jobs = await GreenhouseScraper(client).scrape("notion")
    assert jobs == []


@pytest.mark.asyncio
async def test_greenhouse_http_error_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://boards-api.greenhouse.io/v1/boards/unknown/jobs?content=true",
        status_code=404,
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await GreenhouseScraper(client).scrape("unknown")


def test_greenhouse_is_registered():
    assert "greenhouse" in SCRAPER_REGISTRY
    assert SCRAPER_REGISTRY["greenhouse"] is GreenhouseScraper
