# Frontend Design Spec — Charles Job Scraper

**Date:** 2026-05-28  
**Status:** Approved

## Overview

Add a web frontend to the Charles job scraper. Two pages: a dense jobs table and a resume manager with PDF parsing. Functional, IDE-like aesthetic — dark grey, dark purple accents, gold highlights.

## Decisions Made

| Question | Decision |
|---|---|
| Resume file formats | PDF only |
| Frontend stack | FastAPI (API) + Next.js 14 (UI) |
| Filtering | Server-side query params |
| Navigation | Sidebar (persistent left rail) |
| Resume detail view | Two-panel: list left, tabbed sections right |
| PDF parsing | `pdfplumber` + regex section detection |
| PDF storage | Filesystem (`uploads/`) |

---

## Architecture

Two processes, one repo:

```
FastAPI (port 8000)          Next.js (port 3000)
─────────────────────        ───────────────────
REST API + file I/O    ←──   next.config proxies
SQLAlchemy + SQLite          /api/* → :8000
uploads/ directory           React + TypeScript
```

The existing scraper (`scheduler.py`, `scrapers/`, `storage/`) is untouched. FastAPI is a new entry point. Next.js proxies all `/api/*` to FastAPI so the browser talks to a single origin, avoiding CORS.

**New top-level directories:**
```
api/          FastAPI app
parser/       PDF extraction + section detection
frontend/     Next.js project
uploads/      PDF storage (gitignored)
```

---

## Backend

### FastAPI structure

```
api/
  __init__.py
  app.py              # FastAPI instance, mounts routers
  routers/
    jobs.py           # GET /api/jobs, GET /api/jobs/filters
    resumes.py        # resume CRUD + upload
```

### API Endpoints

**Jobs:**
```
GET /api/jobs
  ?search=     partial match on title
  ?company=    exact match
  ?source=     greenhouse | ashby | lever
  ?seniority=  intern | full_time
  ?page=       default 1
  ?limit=      default 100

GET /api/jobs/filters
  → { companies: [...], sources: [...] }
```

**Resumes:**
```
GET    /api/resumes          → list (id, filename, uploaded_at, section_count)
POST   /api/resumes          → upload PDF (multipart/form-data); parses immediately
GET    /api/resumes/{id}     → metadata + all parsed sections
DELETE /api/resumes/{id}     → deletes DB rows + file from disk
```

### New DB Tables

Added to `storage/models.py`:

```python
class Resume(Base):
    __tablename__ = "resumes"
    id:          str (UUID, PK)
    filename:    str
    file_path:   str
    uploaded_at: datetime

class ResumeSection(Base):
    __tablename__ = "resume_sections"
    id:           int (PK, autoincrement)
    resume_id:    str (FK → resumes.id)
    section_type: str  # experience | projects | education | skills | contact
    content:      text
```

---

## Resume Parser

```
parser/
  __init__.py
  pdf.py       # pdfplumber text extraction
  sections.py  # regex section detection + splitting
```

**Flow:**
1. `pdf.py` extracts text from all pages via `pdfplumber`, joins into one string.
2. `sections.py` scans line by line. A line is a section header if it matches:

```python
SECTION_PATTERNS = {
    "experience": r"^(work\s+)?experience$",
    "education":  r"^education$",
    "skills":     r"^(technical\s+)?skills$",
    "projects":   r"^projects$",
    "contact":    r"^(contact|contact\s+info(rmation)?|personal\s+info(rmation)?)$",
}
```

3. Text between consecutive headers is accumulated as that section's content.
4. Result: `dict[str, str]` → persisted as `resume_sections` rows.

**Edge cases:**
- Headers matched case-insensitively (lowercased before matching)
- Missing sections simply not stored; UI hides their tabs
- Multi-page PDFs: text concatenated across pages before parsing

---

## Frontend

**Stack:** Next.js 14 (App Router), TypeScript, no UI library — hand-styled.

### File Structure

```
frontend/
  next.config.ts            # proxies /api/* → localhost:8000
  app/
    layout.tsx              # root: sidebar shell + content slot
    page.tsx                # redirects → /jobs
    jobs/page.tsx           # jobs table page
    resumes/page.tsx        # two-panel resume page
  components/
    Sidebar.tsx             # persistent left rail, active link highlight
    JobsTable.tsx           # dense table, column headers
    FilterBar.tsx           # search + company/source/seniority dropdowns
    ResumeList.tsx          # left panel: resume list + upload button
    ResumeDetail.tsx        # right panel: tabbed sections
    ResumeUpload.tsx        # file picker, POST to /api/resumes
  lib/
    api.ts                  # typed fetch wrappers
```

### Color Tokens

```css
--bg:         #0d0d1a   /* page background */
--surface:    #111122   /* cards, panels */
--surface-2:  #1a1a2e   /* table rows, elevated */
--border:     #2d2d4e
--sidebar:    #0a0a18
--accent:     #7c3aed   /* purple — active states */
--accent-dim: #c4b5fd   /* purple — text, links */
--gold:       #f59e0b   /* highlights, section headers */
--text:       #e2e8f0
--text-muted: #6b7280
```

### Jobs Table

- Columns: Title, Company, Source, Seniority, Location, Posted At, Updated At
- Filters: search (title), company (dropdown), source (dropdown), seniority (dropdown)
- Dense rows, minimal padding — Google Sheets aesthetic
- Pagination: page controls at bottom, 100 rows default

### Resume Page

- **Left panel (~280px):** Scrollable list of uploaded resumes. Each row shows filename + upload date. Active resume highlighted in purple. "Upload" button at top.
- **Right panel (flex-1):** Tabs for each parsed section present in the resume (hidden if section missing). Section content rendered as preformatted text. Delete button in panel header.

---

## Implementation Phases

Built and verified in order — each phase must work before starting the next:

1. **FastAPI scaffold + jobs API + Next.js + sidebar + jobs table**
2. **Resume DB models + upload API + resume list panel + file storage**
3. **PDF parser + sections API + tabbed section view**

---

## New Dependencies

**Python (`requirements.txt`):**
- `fastapi`
- `uvicorn`
- `python-multipart`
- `pdfplumber`

**Node (`frontend/package.json`):**
- `next`, `react`, `react-dom`, `typescript`
- `@types/react`, `@types/node`

## Files to Gitignore

```
uploads/
frontend/.next/
frontend/node_modules/
.superpowers/
```
