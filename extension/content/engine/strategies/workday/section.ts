// Workday add-and-fill sections (Work Experience, Education). This strategy owns the
// Workday-specific mapping from semantic profile entries → Workday field ids, plus the
// click-Add → diff-new-ids → fill-by-prefix loop.

import { wait, fillInput, setNativeValue, parseDateParts, log, trunc } from '../../dom'
import { findSectionAddButton, SECTION_HEADINGS } from '../../detectors/workday'
import type { FillStrategy, FillResult, ExperienceEntry, EducationEntry } from '../../types'

const DEGREE_MAP: Record<string, string> = {
  'B.S.': 'Bachelor of Science',
  'M.S.': 'Master of Science',
  PhD: 'Doctor of Philosophy',
}

interface EntryPlan {
  namedFields: Record<string, string>      // id suffix → value (filled as text)
  namedCheckboxes: Record<string, boolean> // id suffix → checked
  dateSuffixes: Record<string, string>     // id suffix → value (month/year inputs)
  textareaSuffixes: Record<string, string> // id suffix → value
  typeaheadFields: Record<string, string>  // id suffix → value (type + wait + pick)
  comboboxFields: Record<string, string>   // formField aid → value (click button, pick option)
}

const emptyPlan = (): EntryPlan => ({
  namedFields: {}, namedCheckboxes: {}, dateSuffixes: {}, textareaSuffixes: {}, typeaheadFields: {}, comboboxFields: {},
})

function planExperience(exp: ExperienceEntry): EntryPlan {
  const plan = emptyPlan()
  plan.namedFields.jobTitle = exp.title
  plan.namedFields.companyName = exp.company
  if (exp.location) plan.namedFields.location = exp.location
  plan.namedCheckboxes.currentlyWorkHere = exp.is_current
  const s = parseDateParts(exp.start_date)
  const e = parseDateParts(exp.end_date)
  if (s?.month) plan.dateSuffixes['startDate-dateSectionMonth-input'] = s.month
  if (s?.year) plan.dateSuffixes['startDate-dateSectionYear-input'] = s.year
  if (!exp.is_current && e?.month) plan.dateSuffixes['endDate-dateSectionMonth-input'] = e.month
  if (!exp.is_current && e?.year) plan.dateSuffixes['endDate-dateSectionYear-input'] = e.year
  if (exp.description) plan.textareaSuffixes.roleDescription = exp.description
  return plan
}

function planEducation(edu: EducationEntry): EntryPlan {
  const plan = emptyPlan()
  if (edu.institution) plan.typeaheadFields.school = edu.institution
  if (edu.major) plan.typeaheadFields.fieldOfStudy = edu.major
  if (edu.degree) plan.comboboxFields['formField-degree'] = DEGREE_MAP[edu.degree] ?? edu.degree
  return plan
}

// Websites: each entry is a single URL text field (id suffix `url`, e.g. webAddress-N--url).
function planWebsite(url: string): EntryPlan {
  const plan = emptyPlan()
  if (url) plan.namedFields.url = url
  return plan
}

export const sectionStrategy: FillStrategy = {
  widget: 'wd-section',
  priority: 50,
  async fill(field, ctx) {
    const role = field.role
    const plans: EntryPlan[] =
      role === 'experience' ? ctx.req.experience.map(planExperience)
      : role === 'education' ? ctx.req.education.map(planEducation)
      : role === 'websites' ? ctx.req.websites.map(planWebsite)
      : []
    if (!plans.length) return []

    const headingRe = SECTION_HEADINGS[role]
    const results: FillResult[] = []

    for (let idx = 0; idx < plans.length; idx++) {
      const plan = plans[idx]
      const tag = `${role}[${idx}]`

      // Re-find the Add button each iteration — the DOM changes after each Add.
      const addBtn = findSectionAddButton(headingRe)
      if (!addBtn) { log(`${tag} skipped — no Add button found`); results.push({ role, status: 'skipped' }); continue }

      const existingIds = new Set(
        Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[id], textarea[id]')).map((el) => el.id),
      )
      addBtn.click()
      await wait(700)

      const newEls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[id], textarea[id]'))
        .filter((el) => el.id && !existingIds.has(el.id))
      if (!newEls.length) { log(`${tag} skipped — no new fields after Add`); results.push({ role, status: 'skipped' }); continue }

      const prefix = newEls[0].id.split('--')[0]
      log(`${tag} detected (section, prefix=${prefix})`)
      const before = results.length

      for (const [name, value] of Object.entries(plan.namedFields)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${name}`) as HTMLInputElement | null
        if (el) { fillInput(el, value); log(`${tag}.${name} filled ✓ = "${trunc(value)}"`); results.push({ role, status: 'filled' }) }
        else log(`${tag}.${name} skipped — field not found`)
      }

      for (const [name, checked] of Object.entries(plan.namedCheckboxes)) {
        const el = document.getElementById(`${prefix}--${name}`) as HTMLInputElement | null
        if (el && el.checked !== checked) {
          el.click()
          el.dispatchEvent(new Event('change', { bubbles: true }))
          log(`${tag}.${name} filled ✓ = ${checked ? 'checked' : 'unchecked'}`)
          results.push({ role, status: 'filled' })
        }
      }

      for (const [suffix, value] of Object.entries(plan.dateSuffixes)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${suffix}`) as HTMLInputElement | null
        if (!el) continue
        // Month filled without focusout — firing it before the year is set makes
        // Workday validate an incomplete "08/". focusout on the year validates the pair.
        const isYear = suffix.includes('Year')
        fillInput(el, value, isYear)
        log(`${tag}.${suffix} filled ✓ = "${value}"`)
        results.push({ role, status: 'filled' })
      }

      for (const [suffix, value] of Object.entries(plan.textareaSuffixes)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${suffix}`) as HTMLInputElement | HTMLTextAreaElement | null
        if (el) { fillInput(el, value); log(`${tag}.${suffix} filled ✓ = "${trunc(value)}"`); results.push({ role, status: 'filled' }) }
      }

      // Typeahead (school/major): type, wait for suggestions, click best match or Enter.
      for (const [suffix, value] of Object.entries(plan.typeaheadFields)) {
        if (!value) continue
        const el = document.getElementById(`${prefix}--${suffix}`) as HTMLInputElement | null
        if (!el) continue
        el.focus()
        setNativeValue(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(700)
        const opts = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
        const val = value.toLowerCase()
        const match =
          opts.find((o) => (o.textContent ?? '').trim().toLowerCase() === val) ??
          opts.find((o) => (o.textContent ?? '').trim().toLowerCase().includes(val))
        if (match) {
          match.click()
          log(`${tag}.${suffix} filled ✓ = "${trunc(value)}" (typeahead match)`)
        } else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }))
          log(`${tag}.${suffix} filled ✓ = "${trunc(value)}" (typeahead, Enter fallback)`)
        }
        await wait(200)
        results.push({ role, status: 'filled' })
      }

      // Combobox (degree): click button, pick li[role=option] by text.
      for (const [aid, value] of Object.entries(plan.comboboxFields)) {
        if (!value) continue
        const container = document.querySelector<HTMLElement>(`[data-automation-id="${aid}"]`)
        const trigger = container?.querySelector<HTMLElement>('button')
        if (!trigger) continue
        trigger.click()
        await wait(400)
        const opts = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
        const val = value.toLowerCase()
        const match =
          opts.find((o) => (o.textContent ?? '').trim().toLowerCase() === val) ??
          opts.find((o) => (o.textContent ?? '').trim().toLowerCase().startsWith(val))
        if (match) {
          match.click()
          await wait(200)
          log(`${tag}.${aid} filled ✓ = "${trunc(value)}" (combobox)`)
          results.push({ role, status: 'filled' })
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
          log(`${tag}.${aid} skipped — no option matched "${value}"`)
        }
      }

      if (results.length === before) results.push({ role, status: 'skipped' })
      await wait(200)
    }

    return results
  },
}
