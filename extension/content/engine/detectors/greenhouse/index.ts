// Greenhouse field detector. Greenhouse application forms (job-boards.greenhouse.io,
// boards.greenhouse.io, and the same markup embedded in a cross-origin iframe) are
// largely plain semantic HTML: <input>/<textarea>/<select> with real label[for]
// associations. So the ATS-agnostic half of detection — classifyRole for text/selects,
// GROUP_FIELDS for choice questions — carries the basic fields with no Greenhouse-
// specific code. The Greenhouse-specific widgets are the react-select dropdown (country,
// EEO, work-auth, custom questions → gh-react-select) and the repeatable School/Degree
// education section (gh-education-section). Resume upload remains (see TODO at the bottom).

import { classifyRole, getGroupLabel, GROUP_FIELDS, reactSelectLabel, fieldLabel } from '../../semantic'
import type { Detector, DetectedField } from '../../types'

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio'])

// Greenhouse renders its dropdowns as react-select v5: a div.select__control wrapping a
// real input[role="combobox"].select__input. That inner input is type=text with a
// classifiable id (e.g. "country"), so the plain-text pass would grab it and the text
// strategy's fillInput would corrupt the widget. Detected as gh-react-select instead.
function isReactSelectHoused(el: Element): boolean {
  return el.getAttribute('role') === 'combobox' || el.closest('[class*="select__control"]') !== null
}

export const GreenhouseDetector: Detector = {
  ats: 'greenhouse',
  detectFields(doc: Document): DetectedField[] {
    const fields: DetectedField[] = []

    // Text inputs / textareas / native selects (skip non-text input types + the inputs
    // housed inside a react-select, which are handled by the gh-react-select pass below).
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
      if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return
      if (isReactSelectHoused(el)) return
      const role = classifyRole(el)
      if (!role) return
      fields.push({ role, widget: el instanceof HTMLSelectElement ? 'native-select' : 'text', handle: el })
    })

    // react-select dropdowns (country, EEO/demographic, work-auth, custom Yes/No
    // questions). Question-label (GROUP_FIELDS) matching takes PRIORITY over classifyRole:
    // a choice question like "authorized to work … in the country in which you are applying"
    // must resolve to work_authorized, not be hijacked by classifyRole matching the bare
    // word "country" in its text. classifyRole is the fallback — for the text-like
    // react-selects (country, city/location) whose labels match no group question. A role
    // can legitimately match more than one widget — e.g. the "now" and "in the future"
    // immigration-sponsorship questions both map to requires_sponsorship — so we fill every
    // match with the same stored value (the dispatcher dedupes the role in its reporting).
    // The repeatable education selects (school--0/degree--0) and answerless custom questions
    // classify to nothing and fall through — education is deferred to a future section widget.
    doc.querySelectorAll<HTMLInputElement>('input[role="combobox"]').forEach((input) => {
      const role = GROUP_FIELDS.find((g) => g.re.test(reactSelectLabel(input)))?.role ?? classifyRole(input)
      if (!role) return
      fields.push({ role, widget: 'gh-react-select', handle: input })
    })

    // Radio groups, grouped by name (e.g. some EEO/custom questions render as radios).
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

    // Standalone checkboxes (bool group fields only). fieldLabel resolves the group
    // heading above an acknowledgement checkbox (e.g. privacy consent), which the
    // checkbox's own name/id/label don't carry.
    doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      const allText = [
        cb.getAttribute('name') ?? '',
        cb.id,
        cb.getAttribute('aria-label') ?? '',
        cb.id ? doc.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.textContent ?? '' : '',
        cb.closest('label')?.textContent ?? '',
        fieldLabel(cb),
      ].join(' ').toLowerCase()
      const match = GROUP_FIELDS.find((g) => g.isBool && g.re.test(allText))
      if (!match) return
      fields.push({ role: match.role, widget: 'checkbox', handle: cb })
    })

    // Education section: repeatable School/Degree react-selects (#school--N / #degree--N).
    // Emit a single field for the whole section; the strategy fills (and Adds) per profile
    // entry. School/Degree classify to no role above, so they aren't double-detected.
    const eduSchool = doc.querySelector<HTMLElement>('input[id^="school--"]')
    if (eduSchool) fields.push({ role: 'education', widget: 'gh-education-section', handle: eduSchool })

    // Resume file input (real <input type=file>, usually hidden behind a dropzone).
    const fileInput = doc.querySelector<HTMLElement>('input[type="file"]')
    if (fileInput) fields.push({ role: 'resume', widget: 'file-upload', handle: fileInput })

    // TODO(greenhouse): Resume upload — the file input is hidden until interaction (a live
    // scan found none), so the file-upload pass above no-ops; needs its own probe.

    return fields
  },
}
