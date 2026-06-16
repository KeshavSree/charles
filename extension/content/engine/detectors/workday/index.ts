// Workday field detector. This is the per-ATS surface: it recognizes which DOM
// elements are which widget type, using the FIELDS registry (classifyRe/groupRe/
// aidPattern) plus Workday-specific structure (combobox containers, the skills
// input, the file input, and section Add buttons).

import { FIELDS } from '../../../../../frontend/lib/fields'
import { classifyRole } from '../../semantic'
import type { Detector, DetectedField } from '../../types'

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio'])

// Combobox roles (state, country) — fields with a Workday automation-id pattern.
const COMBOBOX_FIELDS = FIELDS
  .filter((f) => f.aidPattern)
  .map((f) => ({ re: new RegExp(f.aidPattern as string, 'i'), role: f.fillKey ?? f.key }))

// Radio/checkbox roles (work_authorized, gender, …) — fields with a group label regex.
const GROUP_FIELDS = FIELDS
  .filter((f) => f.groupRe)
  .map((f) => ({ re: new RegExp(f.groupRe as string, 'i'), role: f.key, isBool: f.type === 'bool' }))

// Repeatable add-and-fill sections, identified by nearest heading text.
const SECTION_SPECS: Array<{ role: string; headingRe: RegExp }> = [
  { role: 'experience', headingRe: /work.?experience/i },
  { role: 'education', headingRe: /education/i },
  { role: 'websites', headingRe: /websites/i },
]

// A text input housed inside a combobox container must NOT be filled as plain text
// (setting .value breaks Workday's async search). It's detected as wd-combobox instead.
function isComboboxHoused(el: Element): boolean {
  const container = el.closest('[data-automation-id]')
  if (!container) return false
  const aid = container.getAttribute('data-automation-id') ?? ''
  return COMBOBOX_FIELDS.some((c) => c.re.test(aid))
}

/** Combined group label for a set of radios (legend → role group aria → name). */
export function getGroupLabel(radios: HTMLInputElement[]): string {
  for (const r of radios) {
    const legend = r.closest('fieldset')?.querySelector('legend')
    if (legend?.textContent) return legend.textContent.toLowerCase()
  }
  for (const r of radios) {
    const container = r.closest('[role="group"],[role="radiogroup"]')
    if (container) {
      const labelledBy = container.getAttribute('aria-labelledby')
      if (labelledBy) {
        const text = document.getElementById(labelledBy)?.textContent
        if (text) return text.toLowerCase()
      }
      const ariaLabel = container.getAttribute('aria-label')
      if (ariaLabel) return ariaLabel.toLowerCase()
    }
  }
  if (radios[0]?.name) return radios[0].name.toLowerCase()
  return ''
}

/**
 * Find the "Add" button for a section by walking up to 12 ancestors looking for a
 * heading whose text matches. All Workday Add buttons share aid="add-button", so the
 * nearest heading disambiguates which section it belongs to. Exported for the section
 * strategy, which re-finds it on each entry (the DOM changes after each Add).
 */
export function findSectionAddButton(headingRe: RegExp): HTMLElement | null {
  const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="add-button"]'))
  for (const btn of btns) {
    let node: Element | null = btn.parentElement
    for (let k = 0; k < 12 && node; k++, node = node.parentElement) {
      const heading = node.querySelector('h1,h2,h3,h4,[role="heading"]')
      if (heading && headingRe.test(heading.textContent ?? '')) return btn
    }
  }
  return null
}

export const SECTION_HEADINGS: Record<string, RegExp> = Object.fromEntries(
  SECTION_SPECS.map((s) => [s.role, s.headingRe]),
)

export const WorkdayDetector: Detector = {
  ats: 'workday',
  detectFields(doc: Document): DetectedField[] {
    const fields: DetectedField[] = []

    // Text inputs / textareas / native selects (skip non-text types + combobox-housed inputs)
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
      if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return
      if (isComboboxHoused(el)) return
      const role = classifyRole(el)
      if (!role) return
      fields.push({ role, widget: el instanceof HTMLSelectElement ? 'native-select' : 'text', handle: el })
    })

    // Workday comboboxes (country/state) — first container matching each aidPattern
    for (const c of COMBOBOX_FIELDS) {
      for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-automation-id]'))) {
        const aid = el.getAttribute('data-automation-id') ?? ''
        if (c.re.test(aid)) { fields.push({ role: c.role, widget: 'wd-combobox', handle: el }); break }
      }
    }

    // Combobox-style questions: a dropdown whose field label matches a groupRe field
    // (e.g. "Would you consider relocating?" rendered as a select rather than radios).
    // The groupRe filter is the strong signal; we exclude radio/checkbox-rendered
    // questions (handled above) and dedupe per role.
    const cqSeen = new Set<string>()
    const triggers = new Set<HTMLElement>()
    doc.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"], [data-automation-id="selectWidget"]').forEach((t) => triggers.add(t))
    doc.querySelectorAll<HTMLElement>('[data-automation-id^="formField"] button').forEach((t) => triggers.add(t))
    for (const trigger of triggers) {
      const container = trigger.closest<HTMLElement>('[data-automation-id^="formField"]') ?? trigger.parentElement
      if (!container) continue
      if (container.querySelector('input[type="radio"], input[type="checkbox"]')) continue
      const label = (container.textContent ?? '').toLowerCase()
      const match = GROUP_FIELDS.find((g) => g.re.test(label))
      if (!match || cqSeen.has(match.role)) continue
      cqSeen.add(match.role)
      fields.push({ role: match.role, widget: 'wd-combobox-question', handle: container })
    }

    // Radio groups, grouped by name
    const groups = new Map<string, HTMLInputElement[]>()
    doc.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => {
      const key = r.name || r.id || Math.random().toString()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    })
    groups.forEach((radios) => {
      const label = getGroupLabel(radios)
      const match = GROUP_FIELDS.find((g) => g.re.test(label))
      if (!match) return
      const handle = radios[0].closest<HTMLElement>('[role="radiogroup"],[role="group"],fieldset') ?? radios[0]
      fields.push({ role: match.role, widget: 'radio-group', handle })
    })

    // Mutually-exclusive checkbox groups for enum fields (e.g. disability self-ID):
    // a fieldset/group holding 2+ checkboxes whose text matches a string-enum groupRe.
    const cbGroupSeen = new Set<Element>()
    for (const cb of Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      const group = cb.closest<HTMLElement>('fieldset, [role="group"], [data-automation-id$="CheckboxGroup"], [data-automation-id^="formField"]')
      if (!group || cbGroupSeen.has(group)) continue
      if (group.querySelectorAll('input[type="checkbox"]').length < 2) continue
      const text = (group.textContent ?? '').toLowerCase()
      const match = GROUP_FIELDS.find((g) => !g.isBool && g.re.test(text))
      if (!match) continue
      cbGroupSeen.add(group)
      fields.push({ role: match.role, widget: 'wd-checkbox-group', handle: group })
    }

    // Standalone checkboxes (bool group fields only)
    doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      const allText = [
        cb.getAttribute('name') ?? '',
        cb.id,
        cb.getAttribute('aria-label') ?? '',
        cb.id ? document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.textContent ?? '' : '',
        cb.closest('label')?.textContent ?? '',
      ].join(' ').toLowerCase()
      const match = GROUP_FIELDS.find((g) => g.isBool && g.re.test(allText))
      if (!match) return
      fields.push({ role: match.role, widget: 'checkbox', handle: cb })
    })

    // Standalone "Date" calendar field → today's date. A Workday date widget
    // (month/day/year sub-inputs) whose field label is exactly "Date" (so we don't
    // touch "Date of Birth", the From/To experience dates, etc.).
    const dateSeen = new Set<Element>()
    for (const m of Array.from(doc.querySelectorAll<HTMLElement>('[data-automation-id$="dateSectionMonth-input"]'))) {
      const ff = m.closest<HTMLElement>('[data-automation-id^="formField"]')
      if (!ff || dateSeen.has(ff)) continue
      const label = (ff.querySelector('label')?.textContent ?? '').trim()
      const named = ff.querySelector('[name="date" i]')
      if (/^date\s*\*?$/i.test(label) || named) {
        dateSeen.add(ff)
        fields.push({ role: 'date', widget: 'wd-date', handle: ff })
      }
    }

    // Skills multiselect (fixed id)
    const skills = doc.getElementById('skills--skills')
    if (skills) fields.push({ role: 'skills', widget: 'wd-multiselect', handle: skills })

    // Resume file input (real <input type=file>, usually hidden behind a dropzone)
    const fileInput =
      doc.querySelector<HTMLElement>('input[type="file"][data-automation-id="file-upload-input-ref"]') ??
      doc.querySelector<HTMLElement>('input[type="file"]')
    if (fileInput) fields.push({ role: 'resume', widget: 'file-upload', handle: fileInput })

    // Add-and-fill sections (experience / education) — handle is the Add button
    for (const spec of SECTION_SPECS) {
      const addBtn = findSectionAddButton(spec.headingRe)
      if (addBtn) fields.push({ role: spec.role, widget: 'wd-section', handle: addBtn })
    }

    return fields
  },
}
