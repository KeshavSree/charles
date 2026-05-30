# Radio / Checkbox Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the autofill extension to fill radio button groups and checkboxes for standard application questions, pre-configured in the Info page.

**Architecture:** Six new nullable columns on `UserInfo` (two booleans, four strings) flow through the FastAPI info router to the frontend Info page — booleans rendered as Yes/No/— segmented pickers, strings as text inputs. The extension's `fillPageFields` gains a second pass that groups radio inputs by `name`, keyword-matches the group label to a stored field, and clicks the right option.

**Tech Stack:** Python / SQLAlchemy async, FastAPI / Pydantic, Next.js 14 / TypeScript, Chrome Extension MV3 / TypeScript / esbuild

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `storage/models.py` | Modify | Add 6 new columns to `UserInfo` |
| `storage/db.py` | Modify | Add 6 migration ALTER TABLE statements |
| `storage/repository.py` | Modify | Copy 6 new fields in `save_info` |
| `api/routers/info.py` | Modify | Add fields to `InfoOut` / `InfoIn` and router handler |
| `tests/test_info_model.py` | Modify | Assert new columns exist |
| `tests/test_info_api.py` | Modify | PUT/GET with new boolean and string fields |
| `frontend/lib/api.ts` | Modify | Add 6 fields to `UserInfo` interface |
| `frontend/app/info/page.tsx` | Modify | Add segmented picker + Application Questions section |
| `extension/popup/popup.ts` | Modify | Extend `UserInfo`, `mergeForFill`, add radio/checkbox pass |

---

### Task 1: Add 6 new columns to UserInfo model + migrations

**Files:**
- Modify: `storage/models.py`
- Modify: `storage/db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_info_model.py`:

```python
async def test_user_info_has_application_question_columns(db_session):
    from datetime import datetime, timezone
    from storage.models import UserInfo
    now = datetime.now(tz=timezone.utc)
    db_session.add(UserInfo(
        id="default2",
        work_authorized=True,
        requires_sponsorship=False,
        gender="Male",
        ethnicity="Asian",
        veteran_status="I am not a protected veteran",
        disability_status="I do not have a disability",
        updated_at=now,
    ))
    await db_session.commit()
    from sqlalchemy import select
    row = (await db_session.execute(
        select(UserInfo).where(UserInfo.id == "default2")
    )).scalar_one()
    assert row.work_authorized is True
    assert row.requires_sponsorship is False
    assert row.gender == "Male"
    assert row.veteran_status == "I am not a protected veteran"
```

- [ ] **Step 2: Run test to confirm it fails**

```
pytest tests/test_info_model.py::test_user_info_has_application_question_columns -v
```
Expected: `FAILED` with `TypeError` (unexpected keyword arguments)

- [ ] **Step 3: Add columns to `storage/models.py`**

In the `UserInfo` class, add after the `work_auth` column and before `updated_at`:

```python
    work_authorized: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    requires_sponsorship: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    ethnicity: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    veteran_status: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    disability_status: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
```

- [ ] **Step 4: Add migrations to `storage/db.py`**

Append to the `_MIGRATIONS` list:

```python
    "ALTER TABLE user_info ADD COLUMN work_authorized BOOLEAN",
    "ALTER TABLE user_info ADD COLUMN requires_sponsorship BOOLEAN",
    "ALTER TABLE user_info ADD COLUMN gender VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN ethnicity VARCHAR(128)",
    "ALTER TABLE user_info ADD COLUMN veteran_status VARCHAR(256)",
    "ALTER TABLE user_info ADD COLUMN disability_status VARCHAR(256)",
```

- [ ] **Step 5: Run test to confirm it passes**

```
pytest tests/test_info_model.py -v
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add storage/models.py storage/db.py tests/test_info_model.py
git commit -m "feat: add work_authorized, requires_sponsorship, gender, ethnicity, veteran_status, disability_status to UserInfo"
```

---

### Task 2: Update repository, API router, and API tests

**Files:**
- Modify: `storage/repository.py`
- Modify: `api/routers/info.py`
- Modify: `tests/test_info_api.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_info_api.py`:

```python
async def test_put_info_boolean_fields(client):
    payload = {
        "first_name": "", "last_name": "", "email": "",
        "phone": None, "linkedin_url": None,
        "address": None, "city": None, "state": None,
        "zip_code": None, "country": None, "work_auth": None,
        "work_authorized": True,
        "requires_sponsorship": False,
        "gender": "Male",
        "ethnicity": "Asian",
        "veteran_status": "I am not a protected veteran",
        "disability_status": "I do not have a disability",
    }
    resp = await client.put("/api/info", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["work_authorized"] is True
    assert data["requires_sponsorship"] is False
    assert data["gender"] == "Male"
    assert data["veteran_status"] == "I am not a protected veteran"


async def test_put_info_null_booleans_preserved(client):
    payload = {
        "first_name": "", "last_name": "", "email": "",
        "phone": None, "linkedin_url": None,
        "address": None, "city": None, "state": None,
        "zip_code": None, "country": None, "work_auth": None,
        "work_authorized": None, "requires_sponsorship": None,
        "gender": None, "ethnicity": None,
        "veteran_status": None, "disability_status": None,
    }
    resp = await client.put("/api/info", json=payload)
    assert resp.status_code == 200
    assert resp.json()["work_authorized"] is None
    assert resp.json()["gender"] is None
```

- [ ] **Step 2: Run to confirm they fail**

```
pytest tests/test_info_api.py::test_put_info_boolean_fields tests/test_info_api.py::test_put_info_null_booleans_preserved -v
```
Expected: `FAILED` — validation error (unknown fields)

- [ ] **Step 3: Update `storage/repository.py` — `save_info`**

In the `if existing:` block inside `save_info`, add after `existing.work_auth = data.work_auth`:

```python
        existing.work_authorized = data.work_authorized
        existing.requires_sponsorship = data.requires_sponsorship
        existing.gender = data.gender
        existing.ethnicity = data.ethnicity
        existing.veteran_status = data.veteran_status
        existing.disability_status = data.disability_status
```

- [ ] **Step 4: Update `api/routers/info.py`**

Replace the entire file with:

```python
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import UserInfo
from storage.repository import get_or_create_info, save_info

router = APIRouter()


class InfoOut(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str | None
    linkedin_url: str | None
    address: str | None
    city: str | None
    state: str | None
    zip_code: str | None
    country: str | None
    work_auth: str | None
    work_authorized: bool | None
    requires_sponsorship: bool | None
    gender: str | None
    ethnicity: str | None
    veteran_status: str | None
    disability_status: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class InfoIn(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str | None = None
    linkedin_url: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    country: str | None = None
    work_auth: str | None = None
    work_authorized: bool | None = None
    requires_sponsorship: bool | None = None
    gender: str | None = None
    ethnicity: str | None = None
    veteran_status: str | None = None
    disability_status: str | None = None


@router.get("/info", response_model=InfoOut)
async def get_info(session: AsyncSession = Depends(get_db)) -> InfoOut:
    row = await get_or_create_info(session)
    return InfoOut.model_validate(row)


@router.put("/info", response_model=InfoOut)
async def update_info(
    body: InfoIn, session: AsyncSession = Depends(get_db)
) -> InfoOut:
    data = UserInfo(
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        phone=body.phone,
        linkedin_url=body.linkedin_url,
        address=body.address,
        city=body.city,
        state=body.state,
        zip_code=body.zip_code,
        country=body.country,
        work_auth=body.work_auth,
        work_authorized=body.work_authorized,
        requires_sponsorship=body.requires_sponsorship,
        gender=body.gender,
        ethnicity=body.ethnicity,
        veteran_status=body.veteran_status,
        disability_status=body.disability_status,
        updated_at=datetime.now(tz=timezone.utc),
    )
    row = await save_info(session, data)
    return InfoOut.model_validate(row)
```

- [ ] **Step 5: Run tests**

```
pytest tests/test_info_api.py -v
```
Expected: all PASS

- [ ] **Step 6: Run full suite**

```
pytest
```
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add storage/repository.py api/routers/info.py tests/test_info_api.py
git commit -m "feat: expose work_authorized, requires_sponsorship, gender, ethnicity, veteran_status, disability_status on info API"
```

---

### Task 3: Update frontend UserInfo type and Info page

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/info/page.tsx`

- [ ] **Step 1: Update `UserInfo` interface in `frontend/lib/api.ts`**

Replace the `UserInfo` interface with:

```typescript
export interface UserInfo {
  first_name: string
  last_name: string
  email: string
  phone: string | null
  linkedin_url: string | null
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  work_auth: string | null
  work_authorized: boolean | null
  requires_sponsorship: boolean | null
  gender: string | null
  ethnicity: string | null
  veteran_status: string | null
  disability_status: string | null
}
```

- [ ] **Step 2: Rewrite `frontend/app/info/page.tsx`**

Replace the entire file with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { UserInfo, fetchInfo, updateInfo } from '@/lib/api'

const TEXT_FIELDS: { key: keyof UserInfo; label: string; type?: string }[] = [
  { key: 'first_name',   label: 'First Name' },
  { key: 'last_name',    label: 'Last Name' },
  { key: 'email',        label: 'Email', type: 'email' },
  { key: 'phone',        label: 'Phone', type: 'tel' },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
  { key: 'address',      label: 'Address' },
  { key: 'city',         label: 'City' },
  { key: 'state',        label: 'State' },
  { key: 'zip_code',     label: 'Zip Code' },
  { key: 'country',      label: 'Country' },
  { key: 'work_auth',    label: 'Work Authorization' },
]

const BOOL_FIELDS: { key: keyof UserInfo; label: string }[] = [
  { key: 'work_authorized',    label: 'Authorized to work in this country?' },
  { key: 'requires_sponsorship', label: 'Requires visa sponsorship?' },
]

const STRING_QUESTION_FIELDS: { key: keyof UserInfo; label: string }[] = [
  { key: 'gender',           label: 'Gender' },
  { key: 'ethnicity',        label: 'Race / Ethnicity' },
  { key: 'veteran_status',   label: 'Veteran Status' },
  { key: 'disability_status', label: 'Disability Status' },
]

const EMPTY: UserInfo = {
  first_name: '', last_name: '', email: '',
  phone: null, linkedin_url: null,
  address: null, city: null, state: null, zip_code: null, country: null,
  work_auth: null,
  work_authorized: null, requires_sponsorship: null,
  gender: null, ethnicity: null, veteran_status: null, disability_status: null,
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px',
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '6px 10px',
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: '4px', color: 'var(--text)', fontSize: '13px', boxSizing: 'border-box',
}

function BoolPicker({
  label, value, onChange, disabled,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
  disabled: boolean
}) {
  const opts: { label: string; val: boolean | null }[] = [
    { label: 'Yes', val: true },
    { label: 'No',  val: false },
    { label: '—',   val: null },
  ]
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={LABEL_STYLE}>{label}</label>
      <div style={{ display: 'flex', gap: '6px' }}>
        {opts.map((o) => {
          const active = value === o.val
          return (
            <button
              key={String(o.val)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.val)}
              style={{
                padding: '5px 14px',
                fontSize: '12px',
                borderRadius: '4px',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent)' : 'var(--surface-2)',
                color: active ? '#fff' : 'var(--text-muted)',
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function InfoPage() {
  const [info, setInfo] = useState<UserInfo>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading')

  useEffect(() => {
    fetchInfo()
      .then((d) => { setInfo(d); setStatus('idle') })
      .catch(() => setStatus('error'))
  }, [])

  const setText = (key: keyof UserInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInfo((prev) => ({ ...prev, [key]: e.target.value || null }))

  const setBool = (key: keyof UserInfo) => (v: boolean | null) =>
    setInfo((prev) => ({ ...prev, [key]: v }))

  async function handleSave() {
    setStatus('saving')
    try {
      const updated = await updateInfo(info)
      setInfo(updated)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('error')
    }
  }

  const SECTION_LABEL: React.CSSProperties = {
    color: 'var(--text-muted)', fontSize: '11px',
    letterSpacing: '.06em', margin: '20px 0 12px',
  }

  return (
    <div style={{ padding: '32px', maxWidth: '480px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
        <h1 style={{ color: 'var(--gold)', fontSize: '13px', fontWeight: 700, letterSpacing: '.08em', margin: 0 }}>
          INFO
        </h1>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Used by the extension to fill application forms
        </span>
      </div>

      {TEXT_FIELDS.map(({ key, label, type }) => (
        <div key={key} style={{ marginBottom: '14px' }}>
          <label style={LABEL_STYLE}>{label}</label>
          <input
            type={type ?? 'text'}
            value={(info[key] as string) ?? ''}
            onChange={setText(key)}
            disabled={status === 'loading'}
            style={INPUT_STYLE}
          />
        </div>
      ))}

      <div style={SECTION_LABEL}>APPLICATION QUESTIONS</div>

      {BOOL_FIELDS.map(({ key, label }) => (
        <BoolPicker
          key={key}
          label={label}
          value={info[key] as boolean | null}
          onChange={setBool(key)}
          disabled={status === 'loading'}
        />
      ))}

      {STRING_QUESTION_FIELDS.map(({ key, label }) => (
        <div key={key} style={{ marginBottom: '14px' }}>
          <label style={LABEL_STYLE}>{label}</label>
          <input
            type="text"
            value={(info[key] as string) ?? ''}
            onChange={setText(key)}
            disabled={status === 'loading'}
            style={INPUT_STYLE}
          />
        </div>
      ))}

      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleSave}
          disabled={status === 'saving' || status === 'loading'}
          style={{
            padding: '7px 20px', background: 'var(--accent)', border: 'none',
            borderRadius: '4px', color: '#fff', fontSize: '13px',
            fontWeight: 500, cursor: 'pointer',
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && <span style={{ fontSize: '12px', color: 'var(--gold)' }}>Saved</span>}
        {status === 'error' && <span style={{ fontSize: '12px', color: '#f87171' }}>Something went wrong</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Confirm TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/app/info/page.tsx
git commit -m "feat: add Application Questions section to Info page with Yes/No pickers"
```

---

### Task 4: Update extension — UserInfo interface, merge, and radio/checkbox pass

**Files:**
- Modify: `extension/popup/popup.ts`

- [ ] **Step 1: Update `UserInfo` interface and `mergeForFill`**

Replace the `UserInfo` interface and `mergeForFill` function at the top of `extension/popup/popup.ts`:

```typescript
interface UserInfo {
  first_name: string; last_name: string; email: string
  phone: string | null; linkedin_url: string | null
  address: string | null; city: string | null; state: string | null
  zip_code: string | null; country: string | null; work_auth: string | null
  work_authorized: boolean | null; requires_sponsorship: boolean | null
  gender: string | null; ethnicity: string | null
  veteran_status: string | null; disability_status: string | null
}

interface ResumeProfile {
  first_name: string; last_name: string; email: string
  phone: string | null; linkedin_url: string | null
  location: string | null; work_auth: string | null
}

// Info fields win; resume profile fills anything Info left empty.
function mergeForFill(info: UserInfo, profile: ResumeProfile | null): UserInfo {
  const pick = (a: string | null, b: string | null) => a || b || null
  return {
    first_name:           pick(info.first_name || null, profile?.first_name   ?? null) ?? '',
    last_name:            pick(info.last_name  || null, profile?.last_name    ?? null) ?? '',
    email:                pick(info.email      || null, profile?.email        ?? null) ?? '',
    phone:                pick(info.phone,              profile?.phone        ?? null),
    linkedin_url:         pick(info.linkedin_url,       profile?.linkedin_url ?? null),
    address:              info.address,
    city:                 pick(info.city,               profile?.location     ?? null),
    state:                info.state,
    zip_code:             info.zip_code,
    country:              info.country,
    work_auth:            pick(info.work_auth,          profile?.work_auth    ?? null),
    work_authorized:      info.work_authorized,
    requires_sponsorship: info.requires_sponsorship,
    gender:               info.gender,
    ethnicity:            info.ethnicity,
    veteran_status:       info.veteran_status,
    disability_status:    info.disability_status,
  }
}
```

- [ ] **Step 2: Add `fillPageFields` signature update and radio/checkbox pass**

`fillPageFields` currently takes `UserInfo` — the signature stays the same. Add the second pass inside the function, after the existing `return { filled, skipped }` line is pushed back. Replace the end of `fillPageFields` (the `return` statement) with:

```typescript
  // Pass 2: radio groups and checkboxes
  const KEYWORD_MAP: Array<{ field: keyof UserInfo; pattern: RegExp }> = [
    { field: 'work_authorized',    pattern: /authorized.{0,10}work|work.{0,10}authoriz|legally authorized|eligible to work/i },
    { field: 'requires_sponsorship', pattern: /sponsor/i },
    { field: 'gender',             pattern: /\bgender\b/i },
    { field: 'ethnicity',          pattern: /\bethnicity\b|\brace\b|\bracial\b/i },
    { field: 'veteran_status',     pattern: /\bveteran\b/i },
    { field: 'disability_status',  pattern: /\bdisabilit/i },
  ]

  function resolveGroupLabel(inputs: HTMLInputElement[]): string {
    // Check name attribute
    const name = inputs[0].name ?? ''
    // Check fieldset legend
    const fieldset = inputs[0].closest('fieldset')
    const legend = fieldset?.querySelector('legend')?.textContent ?? ''
    // Check aria-labelledby
    const labelledBy = inputs[0].getAttribute('aria-labelledby')
    const ariaText = labelledBy ? (document.getElementById(labelledBy)?.textContent ?? '') : ''
    // Check closest role=group label
    const group = inputs[0].closest('[role="group"]')
    const groupLabel = group?.getAttribute('aria-label') ?? ''
    return [legend, ariaText, groupLabel, name].join(' ')
  }

  function classifyGroup(label: string): keyof UserInfo | null {
    for (const { field, pattern } of KEYWORD_MAP) {
      if (pattern.test(label)) return field
    }
    return null
  }

  function labelTextForInput(el: HTMLInputElement): string {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (lbl) return lbl.textContent?.trim() ?? ''
    }
    return el.closest('label')?.textContent?.trim() ?? el.value
  }

  const TRUE_VALS  = new Set(['yes', '1', 'true'])
  const FALSE_VALS = new Set(['no',  '0', 'false'])

  // Group radio inputs by name
  const radioGroups = new Map<string, HTMLInputElement[]>()
  document.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((el) => {
    const key = el.name || el.id
    if (!key) return
    if (!radioGroups.has(key)) radioGroups.set(key, [])
    radioGroups.get(key)!.push(el)
  })

  radioGroups.forEach((inputs) => {
    const label = resolveGroupLabel(inputs)
    const field = classifyGroup(label)
    if (!field) { skipped += inputs.length; return }
    const stored = profile[field]
    if (stored === null || stored === undefined) { skipped += inputs.length; return }

    let clicked = false
    for (const input of inputs) {
      const optLabel = labelTextForInput(input).toLowerCase()
      const optValue = input.value.toLowerCase()
      let match = false
      if (typeof stored === 'boolean') {
        const targets = stored ? TRUE_VALS : FALSE_VALS
        match = targets.has(optLabel) || targets.has(optValue)
      } else {
        match = optLabel === (stored as string).toLowerCase() ||
                optValue === (stored as string).toLowerCase()
      }
      if (match) {
        try { input.click(); input.dispatchEvent(new Event('change', { bubbles: true })) } catch { /* skip */ }
        filled++
        clicked = true
        break
      }
    }
    if (!clicked) skipped += inputs.length
  })

  // Checkboxes
  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
    const labelText = labelTextForInput(el)
    const field = classifyGroup(labelText)
    if (!field) { skipped++; return }
    const stored = profile[field]
    if (stored === null || stored === undefined || typeof stored !== 'boolean') { skipped++; return }
    const shouldBeChecked = stored
    if (el.checked !== shouldBeChecked) {
      try { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })) } catch { /* skip */ }
      filled++
    } else {
      skipped++
    }
  })

  return { filled, skipped }
}
```

- [ ] **Step 3: Build the extension**

```bash
cd extension && npm run build
```
Expected: clean build, `dist/popup/popup.js` updated, no errors

- [ ] **Step 4: Commit**

```bash
git add extension/popup/popup.ts
git commit -m "feat: add radio group and checkbox autofill pass to fillPageFields"
```

- [ ] **Step 5: Reload the extension**

`chrome://extensions` → reload Charles Autofill

---

## Self-Review

**Spec coverage:**
- ✅ Six new UserInfo fields (Task 1)
- ✅ Migrations (Task 1)
- ✅ API updated (Task 2)
- ✅ Boolean picker UI (Task 3)
- ✅ String question fields in Info page (Task 3)
- ✅ Radio group keyword matching (Task 4)
- ✅ Checkbox handling (Task 4)
- ✅ Skip on null (Task 4 — `if (stored === null || stored === undefined)`)
- ✅ Boolean → yes/1/true / no/0/false matching (Task 4 — `TRUE_VALS` / `FALSE_VALS`)
- ✅ String → case-insensitive label match (Task 4)

**Type consistency:** `UserInfo` is extended in Task 1 (model), Task 2 (Pydantic), Task 3 (TypeScript), and Task 4 (extension interface + mergeForFill) — all use the same 6 field names with matching types.

**No placeholders found.**
