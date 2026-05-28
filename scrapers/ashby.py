# scrapers/ashby.py
from __future__ import annotations

from datetime import datetime, timezone

from scrapers.base import BaseScraper, JobPosting
from scrapers.registry import register

_BASE_URL = "https://api.ashbyhq.com/posting-api/job-board/{company}"


@register("ashby")
class AshbyScraper(BaseScraper):
    """Scraper for Ashby ATS public posting API."""

    async def scrape(self, company: str) -> list[JobPosting]:
        url = _BASE_URL.format(company=company)
        response = await self._client.get(url)
        response.raise_for_status()
        data = response.json()
        return [
            JobPosting(
                id=posting["id"],
                source="ashby",
                company=company,
                title=posting["title"],
                url=posting.get("jobUrl") or posting.get("applyUrl") or posting.get("applicationLink", ""),
                location=posting.get("location") or posting.get("locationName"),
                description=posting.get("descriptionHtml"),
                posted_at=datetime.fromisoformat(
                    posting["publishedAt"].replace("Z", "+00:00")
                ),
            )
            for posting in data.get("jobs", data.get("jobPostings", []))
        ]
