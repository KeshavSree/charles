# storage/db.py
from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import Settings
from storage.models import Base

logger = logging.getLogger(__name__)

_settings = Settings()
_engine = create_async_engine(_settings.database_url, echo=False)
SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    _engine, expire_on_commit=False
)


_MIGRATIONS = [
    "ALTER TABLE user_info ADD COLUMN address VARCHAR(256)",
    "ALTER TABLE user_info ADD COLUMN city VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN state VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN zip_code VARCHAR(16)",
    "ALTER TABLE user_info ADD COLUMN country VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN work_authorized BOOLEAN",
    "ALTER TABLE user_info ADD COLUMN requires_sponsorship BOOLEAN",
    "ALTER TABLE user_info ADD COLUMN gender VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN ethnicity VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN veteran_status VARCHAR(256)",
    "ALTER TABLE user_info ADD COLUMN disability_status VARCHAR(256)",
    "ALTER TABLE user_info ADD COLUMN chosen_name VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN pronouns VARCHAR(64)",
    "ALTER TABLE user_info ADD COLUMN github VARCHAR(256)",
    "ALTER TABLE user_info ADD COLUMN website VARCHAR(256)",
    "ALTER TABLE user_info ADD COLUMN job_alerts BOOLEAN",
]


# Companies seeded into an empty tracked_companies table.
#
# Entries are careers URLs, not board slugs: the provider registry derives the ATS and
# API endpoint itself, so there is nothing to guess and a wrong URL shows up in board
# health rather than 404ing quietly.
#
# The `enabled=False` block is the honest state of charles's old companies.yaml — those
# names were configured against Greenhouse but returned nothing, because they are not
# on a public Greenhouse board under that slug. They are kept as visible, disabled
# to-dos instead of being silently dropped or left broken.
_SEED_COMPANIES: list[tuple[str, str, bool, str | None]] = [
    ("Stripe", "https://job-boards.greenhouse.io/stripe", True, None),
    ("MongoDB", "https://job-boards.greenhouse.io/mongodb", True, None),
    ("Datadog", "https://job-boards.greenhouse.io/datadog", True, None),
    ("Pinterest", "https://job-boards.greenhouse.io/pinterest", True, None),
    ("Airbnb", "https://job-boards.greenhouse.io/airbnb", True, None),
    ("Elastic", "https://job-boards.greenhouse.io/elastic", True, None),
    ("Cloudflare", "https://job-boards.greenhouse.io/cloudflare", True, None),
    ("Twilio", "https://job-boards.greenhouse.io/twilio", True, None),
    ("Lyft", "https://job-boards.greenhouse.io/lyft", True, None),
    ("Dropbox", "https://job-boards.greenhouse.io/dropbox", True, None),
    # Anthropic migrated Ashby -> Greenhouse; the Ashby slug now 404s.
    ("Anthropic", "https://job-boards.greenhouse.io/anthropic", True, None),
    ("Cohere", "https://jobs.ashbyhq.com/cohere", True, None),
    ("OpenAI", "https://jobs.ashbyhq.com/openai", True, None),
    ("Ramp", "https://jobs.ashbyhq.com/ramp", True, None),
    ("Netflix", "https://explore.jobs.netflix.net/careers", False,
     "No public Greenhouse board — needs a verified ATS URL."),
    ("Google", "https://www.google.com/about/careers/applications/", False,
     "Not on a public ATS the scanner supports."),
    ("Apple", "https://jobs.apple.com/", False,
     "Not on a public ATS the scanner supports."),
    ("Amazon", "https://www.amazon.jobs/", False,
     "Needs the `amazon` provider (single-employer)."),
    ("NVIDIA", "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", False,
     "Workday tenant — enable once verified; large board, consider max_pages."),
    ("Uber", "https://www.uber.com/us/en/careers/list/", False,
     "Not on a public ATS the scanner supports."),
    ("Snap", "https://careers.snap.com/jobs", False,
     "Needs a verified ATS URL."),
    ("Notion", "https://job-boards.greenhouse.io/notion", False,
     "Previously returned nothing — verify the board slug."),
    ("Atlassian", "https://www.atlassian.com/company/careers/all-jobs", False,
     "Needs a verified ATS URL."),
    ("HubSpot", "https://www.hubspot.com/careers/jobs", False,
     "Needs a verified ATS URL."),
    ("Zendesk", "https://jobs.zendesk.com/us/en", False,
     "Needs a verified ATS URL."),
    ("CrowdStrike", "https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers", False,
     "Workday tenant — enable once verified."),
    ("Snowflake", "https://careers.snowflake.com/us/en", False,
     "Needs a verified ATS URL."),
    ("Confluent", "https://job-boards.greenhouse.io/confluent", False,
     "Previously returned nothing — verify the board slug."),
]


async def _seed_tracked_companies(conn) -> None:
    """Populate tracked_companies on a fresh database. No-op once any row exists, so
    a user's edits are never overwritten."""
    from datetime import datetime, timezone

    existing = await conn.exec_driver_sql("SELECT COUNT(*) FROM tracked_companies")
    if existing.scalar() > 0:
        return
    now = datetime.now(tz=timezone.utc).isoformat()
    for name, url, enabled, notes in _SEED_COMPANIES:
        await conn.exec_driver_sql(
            "INSERT INTO tracked_companies "
            "(name, careers_url, enabled, notes, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, url, 1 if enabled else 0, notes, now),
        )
    logger.info("Seeded %d tracked companies", len(_SEED_COMPANIES))


async def create_tables() -> None:
    """Create all tables if they do not already exist, then apply additive migrations."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await _seed_tracked_companies(conn)
        except Exception:  # noqa: BLE001 — seeding must never block startup
            logger.warning("Could not seed tracked companies", exc_info=True)
        for stmt in _MIGRATIONS:
            try:
                await conn.exec_driver_sql(stmt)
            except Exception as exc:  # noqa: BLE001 — inspected below
                msg = str(exc).lower()
                # The only expected failure is re-adding a column that already exists
                # (these migrations are additive + idempotent). Anything else is real.
                if "duplicate column" in msg or "already exists" in msg:
                    logger.debug("Migration already applied, skipping: %s", stmt)
                else:
                    logger.error("Migration failed: %s", stmt, exc_info=True)
                    raise


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager that yields a database session."""
    async with SessionLocal() as session:
        yield session
