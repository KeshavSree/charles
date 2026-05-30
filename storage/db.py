# storage/db.py
from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import Settings
from storage.models import Base

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
]


async def create_tables() -> None:
    """Create all tables if they do not already exist, then apply additive migrations."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _MIGRATIONS:
            try:
                await conn.exec_driver_sql(stmt)
            except Exception:
                pass  # column already exists


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager that yields a database session."""
    async with SessionLocal() as session:
        yield session
