from __future__ import annotations

import asyncio
import logging

import httpx
import yaml
from apscheduler.schedulers.blocking import BlockingScheduler

import scrapers.ashby  # noqa: F401 — triggers @register
import scrapers.greenhouse  # noqa: F401 — triggers @register
import scrapers.lever  # noqa: F401 — triggers @register
from config import Settings
from scrapers.registry import get_scraper
from storage.db import create_tables, get_session
from storage.repository import upsert_jobs

logger = logging.getLogger(__name__)


def _load_companies(path: str = "companies.yaml") -> dict[str, list[str]]:
    with open(path) as f:
        return yaml.safe_load(f)


async def run_all_scrapers(companies_path: str = "companies.yaml") -> None:
    """Scrape all configured companies and persist results."""
    await create_tables()
    companies = _load_companies(companies_path)
    async with httpx.AsyncClient(timeout=30.0) as client:
        for source, company_list in companies.items():
            for company in company_list:
                try:
                    scraper = get_scraper(source, client)
                    logger.info("Scraping %s/%s ...", source, company)
                    postings = await scraper.scrape(company)
                    async with get_session() as session:
                        await upsert_jobs(session, postings)
                    logger.info("  -> %d jobs for %s/%s", len(postings), source, company)
                except Exception:
                    logger.exception("Error scraping %s/%s", source, company)


def start_scheduler(settings: Settings) -> None:
    """Run once immediately, then every scrape_interval_hours hours."""
    scheduler = BlockingScheduler()
    scheduler.add_job(
        lambda: asyncio.run(run_all_scrapers()),
        trigger="interval",
        hours=settings.scrape_interval_hours,
        id="scrape_all",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Running initial scrape...")
    asyncio.run(run_all_scrapers())
    logger.info("Initial scrape complete. Scheduler started.")
    scheduler.start()
