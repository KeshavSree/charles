from __future__ import annotations

import abc
from datetime import datetime
from html.parser import HTMLParser
from typing import Optional

import httpx
from pydantic import BaseModel, computed_field, field_validator


class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts).strip()


def _strip_html(value: str) -> str:
    stripper = _HTMLStripper()
    stripper.feed(value)
    return stripper.get_text()


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
    updated_at: Optional[datetime] = None

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id_to_str(cls, v: object) -> str:
        return str(v)

    @field_validator("description", mode="before")
    @classmethod
    def strip_html_from_description(cls, v: object) -> Optional[str]:
        if not isinstance(v, str):
            return v  # type: ignore[return-value]
        text = _strip_html(v)
        return text if text else None

    @computed_field
    @property
    def seniority(self) -> str:
        return "intern" if "intern" in self.title.lower() else "full_time"


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
