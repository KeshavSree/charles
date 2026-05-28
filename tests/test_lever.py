# tests/test_lever.py
import pytest
import httpx
from pytest_httpx import HTTPXMock
from datetime import datetime, timezone

from scrapers.lever import LeverScraper
from scrapers.registry import SCRAPER_REGISTRY

SAMPLE_RESPONSE = [
    {
        "id": "aabbccdd-1234-5678-abcd-ef0123456789",
        "text": "Senior Frontend Engineer",
        "hostedUrl": "https://jobs.lever.co/vercel/aabbccdd-1234-5678-abcd-ef0123456789",
        "descriptionPlain": "We are building the future of the web.",
        "categories": {"location": "Remote", "team": "Engineering"},
        "createdAt": 1620000000000,
    },
    {
        "id": "bbccddee-2345-6789-bcde-f01234567890",
        "text": "DevRel Engineer",
        "hostedUrl": "https://jobs.lever.co/vercel/bbccddee-2345-6789-bcde-f01234567890",
        "descriptionPlain": "Join our DevRel team.",
        "categories": {"location": "New York, NY"},
        "createdAt": 1621000000000,
    },
]


@pytest.mark.asyncio
async def test_lever_scrape_returns_job_postings(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.lever.co/v0/postings/vercel?mode=json",
        json=SAMPLE_RESPONSE,
    )
    async with httpx.AsyncClient() as client:
        jobs = await LeverScraper(client).scrape("vercel")

    assert len(jobs) == 2
    assert jobs[0].source == "lever"
    assert jobs[0].company == "vercel"
    assert jobs[0].title == "Senior Frontend Engineer"
    assert jobs[0].url == "https://jobs.lever.co/vercel/aabbccdd-1234-5678-abcd-ef0123456789"
    assert jobs[0].location == "Remote"
    assert jobs[0].description == "We are building the future of the web."
    assert jobs[0].id == "aabbccdd-1234-5678-abcd-ef0123456789"
    # 1620000000000 ms = 2021-05-03T00:00:00Z
    assert jobs[0].posted_at == datetime(2021, 5, 3, 0, 0, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_lever_missing_location_is_none(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.lever.co/v0/postings/linear?mode=json",
        json=[{
            "id": "no-loc-uuid",
            "text": "Backend Engineer",
            "hostedUrl": "https://jobs.lever.co/linear/no-loc-uuid",
            "descriptionPlain": "Description",
            "categories": {},
            "createdAt": 1620000000000,
        }],
    )
    async with httpx.AsyncClient() as client:
        jobs = await LeverScraper(client).scrape("linear")
    assert jobs[0].location is None


@pytest.mark.asyncio
async def test_lever_empty_response(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.lever.co/v0/postings/linear?mode=json",
        json=[],
    )
    async with httpx.AsyncClient() as client:
        jobs = await LeverScraper(client).scrape("linear")
    assert jobs == []


@pytest.mark.asyncio
async def test_lever_http_error_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://api.lever.co/v0/postings/unknown?mode=json",
        status_code=404,
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await LeverScraper(client).scrape("unknown")


def test_lever_is_registered():
    assert "lever" in SCRAPER_REGISTRY
    assert SCRAPER_REGISTRY["lever"] is LeverScraper
