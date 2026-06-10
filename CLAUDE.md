# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend API
uvicorn api.app:app --reload

# Frontend
cd frontend && npm run dev

# Extension (watch mode is always running — don't run build manually)
cd extension && npm run typecheck   # validate types

# Tests, somewhat of an afterthought rn
pytest
pytest tests/test_ashby.py
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

### Backend (Python / FastAPI)

`api/app.py` mounts five routers under `/api`:

- `jobs` — query scraped job listings
- `resumes` — upload PDF resumes; stored in `uploads/`
- `profiles` — parsed profile derived from a resume (experience, education, contact)
- `info` — singleton `UserInfo` record (all personal/EEO/contact fields a job form might ask)
- `scraper` — trigger a manual scrape run

`api/schemas.py` is the single source of truth for `UserInfo` fields. `storage/models.py` mirrors it as a SQLAlchemy model. Adding a field means one line in each.

### Storage

- `storage/models.py` — ORM models: `Job`, `Resume`, `ResumeSection`, `Profile`, `ProfileExperience`, `ProfileEducation`, `UserInfo`
- `storage/db.py` — async engine + session factory; `create_tables()` is idempotent
- `storage/repository.py` — `upsert_jobs()`, `query_jobs()`, `generate_profile_from_resume()`. Dialect detected at runtime for SQLite/PostgreSQL compatibility

### Scraper

`scrapers/` — Greenhouse, Lever, Ashby scrapers. Each self-registers via `@register("source_name")` in `scrapers/registry.py`. Adding a new ATS:

1. Create `scrapers/<ats>.py` extending `BaseScraper`, implement `async def scrape(self, company: str) -> list[JobPosting]`
2. Import it in `scheduler.py`
3. Add entries under the new source key in `companies.yaml`

### Resume parser

`parser/` — PDF → structured sections → `Profile`. Modules: `pdf.py` (extract text), `sections.py` (split into contact/experience/education), `contact.py`, `experience.py`, `education.py`.

### Frontend (Next.js)

`frontend/app/` pages: `/jobs`, `/resumes`, `/info`. Shares `frontend/lib/fields.ts` with the extension — the canonical list of fillable fields and their metadata.

### Chrome extension

`extension/` — TypeScript, built with esbuild. Entry points: `popup/popup.ts`, `content/engine/`.

The autofill engine uses a detector/strategy pattern:

- **Detectors** (`content/engine/detectors/`) — scan the DOM and return `DetectedField[]`, each tagged with a semantic `role` (a `fields.ts` key) and `widget` type. Currently one detector: `WorkdayDetector`.
- **Strategies** (`content/engine/strategies/`) — one per widget type; know how to fill that widget. Keyed by `WidgetType` in a `Map`.
- **Dispatcher** (`content/engine/dispatcher.ts`) — detect → order by strategy priority → fill → collect results → post-fill review pass.

Adding a new ATS: add a detector in `detectors/`, register it in `detectors/index.ts`. Adding a new widget type: add a strategy in `strategies/`, register it in `strategies/index.ts`, add the type to `WidgetType` in `types.ts`.

`frontend/lib/fields.ts` is imported by both the extension and the frontend — edit it carefully, it affects both.

### Testing

`pytest-asyncio` (`asyncio_mode = auto`) + `pytest-httpx` for mocking HTTP. The `db_session` fixture in `conftest.py` spins up an in-memory SQLite database per test.