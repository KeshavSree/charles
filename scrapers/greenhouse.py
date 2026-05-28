# scrapers/greenhouse.py
from __future__ import annotations

from scrapers.base import BaseScraper, JobPosting
from scrapers.registry import register

_BASE_URL = "https://boards-api.greenhouse.io/v1/boards/{company}/jobs"


@register("greenhouse")
class GreenhouseScraper(BaseScraper):
    """Scraper for Greenhouse ATS public job board API."""

    async def scrape(self, company: str) -> list[JobPosting]:
        url = _BASE_URL.format(company=company)
        response = await self._client.get(url, params={"content": "true"})
        response.raise_for_status()
        data = response.json()
        return [
            JobPosting(
                id=job["id"],
                source="greenhouse",
                company=company,
                title=job["title"],
                url=job["absolute_url"],
                location=job.get("location", {}).get("name"),
                description=job.get("content"),
                posted_at=None,
            )
            for job in data.get("jobs", [])
        ]
