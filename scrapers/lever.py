# scrapers/lever.py
from __future__ import annotations

from datetime import datetime, timezone

from scrapers.base import BaseScraper, JobPosting
from scrapers.registry import register

_BASE_URL = "https://api.lever.co/v0/postings/{company}"


@register("lever")
class LeverScraper(BaseScraper):
    """Scraper for Lever ATS public postings API."""

    async def scrape(self, company: str) -> list[JobPosting]:
        url = _BASE_URL.format(company=company)
        response = await self._client.get(url, params={"mode": "json"})
        response.raise_for_status()
        data: list[dict] = response.json()
        return [
            JobPosting(
                id=posting["id"],
                source="lever",
                company=company,
                title=posting["text"],
                url=posting["hostedUrl"],
                location=posting.get("categories", {}).get("location"),
                description=posting.get("descriptionPlain"),
                posted_at=datetime.fromtimestamp(
                    posting["createdAt"] / 1000, tz=timezone.utc
                ),
            )
            for posting in data
        ]
