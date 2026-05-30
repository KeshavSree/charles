# Info Page Design — Charles Job Applier

**Date:** 2026-05-30
**Status:** Approved

---

## Overview

A standalone top-level **Info** page where the user enters their contact details once. This data is the canonical source for the Chrome extension's autofill — it takes precedence over any resume-derived profile. The page is independent of the Resumes section and requires no resume to be uploaded.

---

## Goals & Non-Goals

**In scope:**
- Singleton user info record (name, email, phone, LinkedIn, location, work auth)
- GET/PUT API endpoints at `/api/info`
- `/info` page in the frontend nav
- Extension popup reads from `/api/info` directly; removes the resume selector

**Out of scope:**
- Experience and education entries (those remain on the per-resume Profile)
- Multi-user / per-account isolation
- Import-from-resume shortcut (user fills manually)

---

## Data Model

### New table: `user_info`

One row in the database, always `id = "default"`.

```
user_info
  id           str  PK  ("default", fixed)
  first_name   str        default ""
  last_name    str        default ""
  email        str        default ""
  phone        str | null
  linkedin_url str | null
  location     str | null
  work_auth    str | null
  updated_at   datetime
```

No foreign key to any other table. Created automatically on first GET if absent.

---

## Backend API

### `GET /api/info`

Returns the singleton row. If the row does not exist, creates it with all fields empty and returns it. Always 200.

**Response:**
```json
{
  "first_name": "",
  "last_name": "",
  "email": "",
  "phone": null,
  "linkedin_url": null,
  "location": null,
  "work_auth": null,
  "updated_at": "2026-05-30T00:00:00Z"
}
```

### `PUT /api/info`

Upserts the singleton. Body mirrors the response shape (all fields optional, omitted fields stay unchanged — but for simplicity the client always sends all fields). Returns updated row.

---

## Repository

Two functions added to `storage/repository.py`:

- `get_or_create_info(session) -> UserInfo` — fetches `id="default"` row; inserts empty row if missing; commits and returns.
- `save_info(session, data: UserInfo) -> UserInfo` — upserts and returns.

---

## Frontend

### Nav

`Sidebar.tsx` gains an **Info** entry between Jobs and Resumes:

```
Jobs
Info       ← new
Resumes
```

### `/info` page

`app/info/page.tsx` — a single-column form with all 7 fields and a Save button. Loads on mount via `GET /api/info`; saves via `PUT /api/info`. No tabs, no cards. Matches existing app design tokens.

### `frontend/lib/api.ts` additions

```typescript
export interface UserInfo { ... }
export async function fetchInfo(): Promise<UserInfo>
export async function updateInfo(data: UserInfo): Promise<UserInfo>
```

---

## Extension Changes

The popup no longer needs a resume selector. On **Fill Form** click:

1. Fetch `GET /api/info` → contact fields
2. Fill using `fillPageFields(info)` — same injected function, same classifier

If the Info record has empty fields (e.g. phone is null), those fields are simply skipped (existing behaviour — `fillPageFields` already skips empty values).

The resume dropdown and resume list fetch are removed from the popup. The popup becomes: status line + single **Fill Form** button.

---

## Extension ↔ Info Precedence

For **contact fields**: Info values win. Since the extension now only reads from `/api/info`, resume profile values are not consulted for contact fields.

For **experience / education**: not filled by the extension today; no change.

---

## Testing

- `tests/test_info_api.py` — GET creates empty singleton; PUT updates and returns; second GET reflects update.
- `tests/test_info_model.py` — `user_info` table exists and accepts a default row.
