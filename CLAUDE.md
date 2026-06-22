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

`extension/` — TypeScript, built with esbuild (watch is always running — use `npm run typecheck`). Entry point: `content/engine/index.ts` (+ `popup/popup.ts`).

The autofill engine is a **registry-driven, ATS × widget × field** model:

- **Registry** (`content/engine/registry.ts`) — THE MAP: `ATS → widget → { field: rule }`. The single place showing which fields each ATS supports and how each is recognized. Each leaf pairs a widget module with the fields it carries, keyed by field role to a recognition rule (a `RegExp`, or a `FieldRule` with `exclude`/`reject`/`resolve`/`fillOpts`). Rules are single-sourced consts listed per-leaf; a field missing from an ATS is a visible gap. Run `npm run coverage` to print the field × ATS matrix.
- **Widgets** (`content/engine/widgets/`) — one module per widget, each owning `detect` (find candidates) + `label` (text to match rules against) + `fill` + `isEmpty`. Shared widgets (`text`, `radio`, `checkbox`, `file`) at the top; ATS-specific under `widgets/greenhouse/` and `widgets/workday/`.
- **Runtime** (`content/engine/runtime.ts`) — the generic loop: detect per widget (registry order; a claimed-subtree set handles "housing" so e.g. a react-select's inner input isn't also filled as text) → match each candidate to a field by its rule → fill (ordered by `widget.priority`, aggressive-gated) → post-fill review (`reviewPass.ts`, via `widget.isEmpty`). Injected into all frames, so a cross-origin ATS iframe resolves via `location.hostname`.
- **Helpers** (`content/engine/helpers/`) — shared utilities: label resolvers (`labels.ts`), option matching (`optionMatch.ts`, incl. phone dial-code tolerance), enum matching (`enumMatch.ts`), polling, the Workday dropdown opener, `worked_here` derivation.
- **Values** (`content/engine/values.ts`) + popup — résumé-derived values (full_name, chosen_name fallback, current_employer/title, degree_pursuing, grad_date) are computed in `popup.ts buildFillRequest` and filled like stored values; DOM-dependent derivation (`worked_here`) is a leaf `resolve`.

Adding a field: add it to `frontend/lib/fields.ts` (the catalog) + `UserInfo` (+ backend `schemas.py`/`models.py`/`db.py` migration if stored), then add a leaf entry per ATS in `registry.ts` with its recognition rule. Adding a widget: add a module in `widgets/`, reference it from registry leaves. Adding an ATS: add a key to `REGISTRY` + `Ats`, compose its widgets.

`frontend/lib/fields.ts` is the field **catalog** (identity/type/options/labels/values), imported by both the extension and the frontend — edit carefully. Detection rules live in the **registry**, not the catalog.

### Testing

`pytest-asyncio` (`asyncio_mode = auto`) + `pytest-httpx` for mocking HTTP. The `db_session` fixture in `conftest.py` spins up an in-memory SQLite database per test.