# storage/repository.py
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from scrapers.base import JobPosting
from storage.models import Job


def _url_to_id(url: str) -> str:
    """Return first 16 hex chars of SHA256(url)."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _dialect_name(session: AsyncSession) -> str:
    """Detect DB dialect from the session's engine URL."""
    sync_session = session.sync_session
    bind = sync_session.get_bind()
    return "postgresql" if "postgresql" in str(bind.url) else "sqlite"


async def upsert_jobs(session: AsyncSession, postings: list[JobPosting]) -> None:
    """Insert or update job rows. Deduplication key: SHA256(url)[:16].

    Works with both SQLite (dev) and PostgreSQL (prod).
    """
    if not postings:
        return

    now = datetime.now(tz=timezone.utc)
    rows = [
        {
            "id": _url_to_id(p.url),
            "source": p.source,
            "company": p.company,
            "title": p.title,
            "url": p.url,
            "location": p.location,
            "description": p.description,
            "posted_at": p.posted_at,
            "scraped_at": now,
        }
        for p in postings
    ]

    dialect = _dialect_name(session)

    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(Job).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={
                "title": stmt.excluded.title,
                "location": stmt.excluded.location,
                "description": stmt.excluded.description,
                "scraped_at": stmt.excluded.scraped_at,
            },
        )
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stmt = sqlite_insert(Job).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={
                "title": stmt.excluded.title,
                "location": stmt.excluded.location,
                "description": stmt.excluded.description,
                "scraped_at": stmt.excluded.scraped_at,
            },
        )

    await session.execute(stmt)
    await session.commit()


async def query_jobs(
    session: AsyncSession,
    *,
    company: Optional[str] = None,
    source: Optional[str] = None,
) -> list[Job]:
    """Query persisted jobs with optional filters."""
    stmt = select(Job)
    if company is not None:
        stmt = stmt.where(Job.company == company)
    if source is not None:
        stmt = stmt.where(Job.source == source)
    result = await session.execute(stmt)
    return list(result.scalars().all())
