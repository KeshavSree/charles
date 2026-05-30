# Radio / Checkbox Autofill Design — Charles Job Applier

**Date:** 2026-05-30
**Status:** Approved

---

## Overview

Extend the autofill extension to fill radio button groups and checkboxes for standard application questions. Answers are pre-configured in the Info page and stored on `UserInfo`. If a field has no stored answer the extension skips it silently.

---

## Goals & Non-Goals

**In scope:**
- Six new fields on `UserInfo`: two booleans (work auth, sponsorship), four strings (gender, ethnicity, veteran status, disability status)
- Info page UI: boolean fields rendered as Yes / No / — segmented picker; string fields as plain text inputs
- Extension: second pass over radio groups and checkboxes using group-label keyword matching

**Out of scope:**
- Company-specific questions (e.g. "Have you worked for Workday before?")
- AI-powered answer inference
- Prompting the user at fill time for unanswered questions

---

## Backend

### UserInfo model additions

Six nullable columns appended to the `user_info` table:

```
work_authorized     bool | null   — true = Yes, false = No, null = skip
requires_sponsorship bool | null  — true = Yes, false = No, null = skip
gender              str  | null   — free text, e.g. "Male", "Female", "Non-binary"
ethnicity           str  | null   — free text, e.g. "Asian", "White"
veteran_status      str  | null   — free text, e.g. "I am not a protected veteran"
disability_status   str  | null   — free text, e.g. "I do not have a disability"
```

### Migration

Add six `ALTER TABLE user_info ADD COLUMN …` statements to `_MIGRATIONS` in `storage/db.py`, following the same pattern as the address field migration.

### API

`InfoOut` and `InfoIn` Pydantic models gain the six new fields. `InfoIn` booleans default to `None`. `save_info` in `repository.py` copies the six new fields through.

---

## Frontend — Info Page

### Boolean fields

Rendered as a **segmented picker**: three pill buttons — `Yes`, `No`, `—` (unanswered). Selecting `—` stores `null`. Stored as `true`/`false`/`null`.

### String fields

Rendered as plain text inputs, identical to the existing contact fields. User types whatever value they expect the form to contain (e.g. "I am not a protected veteran").

### Field order in the form

Appended after Work Authorization in a new visual section labelled **Application Questions**:

```
Work Authorized?          [Yes] [No] [—]
Requires Sponsorship?     [Yes] [No] [—]
Gender                    [____________]
Race / Ethnicity          [____________]
Veteran Status            [____________]
Disability Status         [____________]
```

---

## Extension — fillPageFields changes

### Two-pass structure

**Pass 1 (unchanged):** text inputs, textareas, native selects.

**Pass 2 (new):** radio groups and checkboxes.

### Radio group algorithm

1. Collect all `<input type="radio">` elements into groups keyed by their `name` attribute.
2. For each group, resolve the **group label** by checking in order:
   - The `name` attribute itself
   - The text of the nearest `<legend>` in a parent `<fieldset>`
   - The `aria-labelledby` target text
   - The text of the closest preceding heading or label-like element
3. Keyword-match the group label to a `UserInfo` field (see table below).
4. If no match or stored value is null → skip.
5. For **boolean fields**: find the radio whose label text or `value` attribute matches the truthy/falsy representations (see below) and call `.click()` + dispatch `change`.
6. For **string fields**: find the radio whose label text case-insensitively equals the stored string and click it.

### Checkbox algorithm

1. For each `<input type="checkbox">`:
   - Resolve label text (same logic as the existing `classify` function).
   - Keyword-match to a boolean `UserInfo` field.
   - If stored value is `true` and box is unchecked → click it.
   - If stored value is `false` and box is checked → click it.
   - If stored value is null → skip.

### Keyword map

| UserInfo field | Trigger keywords |
|---|---|
| `work_authorized` | authorized to work, work authorization, legally authorized, eligible to work |
| `requires_sponsorship` | sponsorship, visa sponsor, require.*sponsor |
| `gender` | gender |
| `ethnicity` | ethnicity, race, racial |
| `veteran_status` | veteran |
| `disability_status` | disability, disabled |

### Boolean → option matching

For a `true` value, try matching (case-insensitive) against: `yes`, `1`, `true`.
For a `false` value, try: `no`, `0`, `false`.
Match is checked against both the radio's `value` attribute and its associated label text.

---

## Testing

- `tests/test_info_model.py` — existing test extended to assert new columns exist.
- `tests/test_info_api.py` — PUT with boolean fields; GET reflects them; null fields are preserved.
