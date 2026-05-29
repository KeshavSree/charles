# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the scraper daemon (initial scrape + scheduled interval)
python main.py

# Run all tests
pytest

# Run a single test file
pytest tests/test_ashby.py

# Run a single test by name
pytest tests/test_ashby.py::test_scrape_returns_postings
```

## Environment

Copy `.env.example` to `.env`. All settings are optional — SQLite (`jobs.db`) is used by default.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./jobs.db` | Set to a `postgresql+asyncpg://` URL for prod |
| `SCRAPE_INTERVAL_HOURS` | `6` | How often APScheduler re-runs all scrapers |
| `LOG_LEVEL` | `INFO` | Standard Python log level |

## Architecture

### Data flow

`main.py` → `scheduler.py` → `scrapers/` → `storage/repository.py` → `jobs.db`

1. `main.py` creates tables then hands off to `start_scheduler()`.
2. `scheduler.py` runs `run_all_scrapers()` immediately, then on the configured interval. It reads `companies.yaml` to determine what to scrape, instantiates the appropriate scraper via `get_scraper()`, and calls `upsert_jobs()` with the results.
3. Each scraper fetches from its ATS's public API and returns a list of `JobPosting` (Pydantic model defined in `scrapers/base.py`).
4. `repository.upsert_jobs()` deduplicates by `SHA256(url)[:16]` and persists to SQLite or PostgreSQL using dialect-specific `INSERT … ON CONFLICT DO UPDATE`.

### Scraper registry

Scrapers self-register at import time via the `@register("source_name")` decorator (`scrapers/registry.py`). `scheduler.py` imports all scraper modules explicitly to trigger registration before calling `get_scraper()`. Adding a new ATS scraper requires:

1. Create `scrapers/<ats>.py` with a class decorated `@register("<ats>")` that extends `BaseScraper` and implements `async def scrape(self, company: str) -> list[JobPosting]`.
2. Import the new module in `scheduler.py` (alongside the existing imports).
3. Add entries under the new source key in `companies.yaml`.

### Storage

- `storage/models.py` — SQLAlchemy `Job` ORM model. Primary key is `SHA256(url)[:16]`.
- `storage/db.py` — module-level async engine + session factory; `create_tables()` is idempotent.
- `storage/repository.py` — `upsert_jobs()` and `query_jobs()`. Dialect is detected at runtime so the same code works for both SQLite (dev) and PostgreSQL (prod).

### Configuration

`config.py` uses `pydantic-settings`; values are read from `.env` (if present) and can be overridden by environment variables.

### Testing

Tests use `pytest-asyncio` (`asyncio_mode = auto`) and `pytest-httpx` for mocking HTTP calls. The `db_session` fixture in `conftest.py` spins up an in-memory SQLite database per test.
