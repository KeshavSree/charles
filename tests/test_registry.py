import pytest
import httpx
from scrapers.base import BaseScraper, JobPosting
from scrapers.registry import register, get_scraper, SCRAPER_REGISTRY


@pytest.fixture(autouse=True)
def clean_registry():
    """Isolate registry state between tests."""
    original = dict(SCRAPER_REGISTRY)
    yield
    SCRAPER_REGISTRY.clear()
    SCRAPER_REGISTRY.update(original)


def test_register_decorator_adds_to_registry():
    @register("test_ats")
    class TestScraper(BaseScraper):
        async def scrape(self, company: str) -> list[JobPosting]:
            return []

    assert "test_ats" in SCRAPER_REGISTRY
    assert SCRAPER_REGISTRY["test_ats"] is TestScraper


def test_register_returns_class_unchanged():
    @register("test_ats2")
    class TestScraper2(BaseScraper):
        async def scrape(self, company: str) -> list[JobPosting]:
            return []

    assert TestScraper2.__name__ == "TestScraper2"


def test_get_scraper_returns_instance():
    @register("test_ats3")
    class TestScraper3(BaseScraper):
        async def scrape(self, company: str) -> list[JobPosting]:
            return []

    client = httpx.AsyncClient()
    scraper = get_scraper("test_ats3", client)
    assert isinstance(scraper, TestScraper3)


def test_get_scraper_unknown_raises():
    with pytest.raises(KeyError, match="no_such_ats"):
        get_scraper("no_such_ats", httpx.AsyncClient())


def test_register_duplicate_raises():
    @register("duplicate_ats")
    class A(BaseScraper):
        async def scrape(self, company: str) -> list[JobPosting]:
            return []

    with pytest.raises(ValueError, match="duplicate_ats"):
        @register("duplicate_ats")
        class B(BaseScraper):
            async def scrape(self, company: str) -> list[JobPosting]:
                return []
