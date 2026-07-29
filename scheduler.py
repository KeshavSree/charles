from __future__ import annotations

import asyncio
import logging

from apscheduler.schedulers.blocking import BlockingScheduler

from config import Settings
from scanner.service import run_scheduled_scan
from storage.db import create_tables

logger = logging.getLogger(__name__)


async def run_all_scrapers() -> None:
    """Scan every enabled tracked company and persist the results.

    Targets come from the `tracked_companies` table rather than a YAML file — a
    company is identified by its careers URL, and the provider registry resolves the
    ATS itself. A wrong URL surfaces in board health instead of 404ing silently.
    """
    await create_tables()
    await run_scheduled_scan()


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
    logger.info("Running initial scan...")
    asyncio.run(run_all_scrapers())
    logger.info("Initial scan complete. Scheduler started.")
    scheduler.start()
