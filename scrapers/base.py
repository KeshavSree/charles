from __future__ import annotations

import abc
from datetime import datetime
from typing import Optional

import httpx
from pydantic import BaseModel, field_validator


class JobPosting(BaseModel):
    """Canonical job posting representation, ATS-agnostic."""

    id: str
    source: str
    company: str
    title: str
    url: str
    location: Optional[str] = None
    description: Optional[str] = None
    posted_at: Optional[datetime] = None

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id_to_str(cls, v: object) -> str:
        return str(v)


class BaseScraper(abc.ABC):
    """Abstract base for all ATS scrapers.

    Set requires_playwright = True on the class for JS-heavy scrapers.
    """

    requires_playwright: bool = False

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    @abc.abstractmethod
    async def scrape(self, company: str) -> list[JobPosting]:
        """Fetch all current job postings for company from this ATS."""
