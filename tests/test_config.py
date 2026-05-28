import pytest
from config import Settings


def test_settings_defaults():
    s = Settings()
    assert s.database_url == "sqlite+aiosqlite:///./jobs.db"
    assert s.scrape_interval_hours == 6
    assert s.log_level == "INFO"


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pw@localhost/jobs")
    monkeypatch.setenv("SCRAPE_INTERVAL_HOURS", "2")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    s = Settings()
    assert s.database_url == "postgresql+asyncpg://user:pw@localhost/jobs"
    assert s.scrape_interval_hours == 2
    assert s.log_level == "DEBUG"
