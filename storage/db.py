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
    # skip_tiers (exclusive) was replaced by seniority_tiers (inclusive). The old
    # column is left in place on existing DBs; SQLAlchemy no longer maps it.
    "ALTER TABLE scan_config ADD COLUMN seniority_tiers JSON",
    # discovery/mode became source_id when discovery modes became registered sources.
    # SQLite cannot rename or drop cleanly, so the new columns are added and backfilled
    # and the old ones are left inert.
    "ALTER TABLE jobs ADD COLUMN source_id VARCHAR(64)",
    "UPDATE jobs SET source_id = discovery WHERE source_id IS NULL",
    "ALTER TABLE scan_runs ADD COLUMN source_id VARCHAR(64)",
    "UPDATE scan_runs SET source_id = mode WHERE source_id IS NULL",
    # Drop the superseded columns rather than leaving them behind. They were declared
    # NOT NULL with no SQL-level default, so once the models stopped mapping them every
    # INSERT failed the old constraint. Ordered after the backfills above, which read
    # them. Re-running is a no-op: "no such column" is treated as already-applied.
    "ALTER TABLE jobs DROP COLUMN discovery",
    "ALTER TABLE scan_runs DROP COLUMN mode",
    "ALTER TABLE scan_config DROP COLUMN since_days",
    "ALTER TABLE scan_config DROP COLUMN shuffle",
    "ALTER TABLE scan_runs ADD COLUMN drops JSON",
    # pipeline_entries.updated_at was renamed to say what it actually tracks: the last
    # time the *user* touched the entry, not a row-modified stamp. On a fresh DB
    # create_all already makes the new name and this reports "no such column", which is
    # treated as already-applied.
    "ALTER TABLE pipeline_entries RENAME COLUMN updated_at TO last_interacted_at",
    "ALTER TABLE pipeline_entries ADD COLUMN contact_email VARCHAR(320)",
    # The résumé header carries these and the autofill catalog already has fields
    # for them; only the profile was dropping them on the floor.
    "ALTER TABLE profiles ADD COLUMN github_url TEXT",
    "ALTER TABLE profiles ADD COLUMN website TEXT",
    "ALTER TABLE scan_runs ADD COLUMN boards_skipped_dead INTEGER",
]


# Companies seeded into an empty tracked_companies table.
#
# Entries are careers URLs, not board slugs: the provider registry derives the ATS and
# API endpoint itself, so there is nothing to guess and a wrong URL shows up in board
# health rather than 404ing quietly.
#
# Every entry below was fetched once to confirm it actually returns postings. The
# disabled ones failed that check and are kept as visible to-dos, with the reason, rather
# than being silently dropped or left enabled and quietly returning nothing.
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
     "No public ATS the scanner supports."),
    ("Google", "https://www.google.com/about/careers/applications/", False,
     "No public ATS the scanner supports."),
    ("Apple", "https://jobs.apple.com/", False,
     "No public ATS the scanner supports."),
    ("Amazon", "https://www.amazon.jobs/", True,
     "Verified. Hits the 2000 posting cap, narrow with query params on the careers URL."),
    ("NVIDIA", "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", True,
     "Workday. Verified. Hits the 2000 posting page cap, raise max_pages for full coverage."),
    ("Uber", "https://www.uber.com/us/en/careers/list/", False,
     "No public ATS the scanner supports."),
    ("Snap", "https://careers.snap.com/jobs", False,
     "No ATS detected from this URL."),
    ("Notion", "https://job-boards.greenhouse.io/notion", False,
     "Greenhouse slug 404s. Needs the real board URL."),
    ("Atlassian", "https://www.atlassian.com/company/careers/all-jobs", False,
     "No ATS detected from this URL."),
    ("HubSpot", "https://www.hubspot.com/careers/jobs", False,
     "No ATS detected from this URL."),
    ("Zendesk", "https://jobs.zendesk.com/us/en", False,
     "No ATS detected from this URL."),
    ("CrowdStrike", "https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers", True,
     "Workday. Verified, ~400 postings."),
    ("Snowflake", "https://careers.snowflake.com/us/en", False,
     "No ATS detected from this URL."),
    ("Confluent", "https://job-boards.greenhouse.io/confluent", False,
     "Greenhouse slug 404s. Needs the real board URL."),
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
                # Two expected failures, both meaning "already in the desired state":
                #   - re-adding a column that exists (migrations are additive/idempotent)
                #   - backfilling from a legacy column on a database that never had one,
                #     which is every fresh install. Anything else is real.
                if (
                    "duplicate column" in msg
                    or "already exists" in msg
                    or "no such column" in msg
                ):
                    logger.debug("Migration already applied, skipping: %s", stmt)
                else:
                    logger.error("Migration failed: %s", stmt, exc_info=True)
                    raise


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager that yields a database session."""
    async with SessionLocal() as session:
        yield session
