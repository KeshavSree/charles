// Workday add-and-fill sections (Work Experience, Education, Websites). Owns the Workday
// mapping from semantic profile entries → Workday field ids, plus the click-Add → diff-new-
// ids → fill-by-prefix loop. The candidate is a section Add button, matched to its role by
// the nearest heading (registry leaf rules). Ported verbatim from the old wd-section strategy
// (with findSectionAddButton/headings inlined here).

import { wait, fillInput, setNativeValue, parseDateParts, log, trunc } from '../../dom'
import { matchOption } from '../../helpers/optionMatch'
import type { Widget, FillResult, ExperienceEntry, EducationEntry } from '../../types'

const SECTION_HEADINGS: Record<string, RegExp> = {
  experience: /work.?experience/i,
  education: /education/i,
  websites: /websites/i,
}

// Find a section's "Add" button by walking up from each add-button to a matching heading.
// All Workday Add buttons share aid="add-button"; the nearest heading disambiguates.
function findSectionAddButton(headingRe: RegExp): HTMLElement | null {
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

const DEGREE_MAP: Record<string, string> = {
  'B.S.': 'Bachelor of Science',
  'M.S.': 'Master of Science',
  PhD: 'Doctor of Philosophy',
}

interface EntryPlan {
  namedFields: Record<string, string>
  namedCheckboxes: Record<string, boolean>
  dateSuffixes: Record<string, string>
  textareaSuffixes: Record<string, string>
  typeaheadFields: Record<string, string>
  comboboxFields: Record<string, string>
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

function planWebsite(url: string): EntryPlan {
  const plan = emptyPlan()
  if (url) plan.namedFields.url = url
  return plan
}

export const sectionWidget: Widget = {
  name: 'section',
  priority: 50,
  detect(doc) {
    return Array.from(doc.querySelectorAll<HTMLElement>('[data-automation-id="add-button"]')).map((b) => ({ handle: b }))
  },
  label(c) {
    let node: Element | null = c.handle.parentElement
    for (let k = 0; k < 12 && node; k++, node = node.parentElement) {
      const heading = node.querySelector('h1,h2,h3,h4,[role="heading"]')
      if (heading?.textContent?.trim()) return heading.textContent.toLowerCase()
    }
    return ''
  },
  async fill(_c, input, ctx) {
    const role = input.field
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

      for (const [aid, value] of Object.entries(plan.comboboxFields)) {
        if (!value) continue
        const container = document.querySelector<HTMLElement>(`[data-automation-id="${aid}"]`)
        const trigger = container?.querySelector<HTMLElement>('button')
        if (!trigger) continue
        trigger.click()
        await wait(400)
        const opts = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
        const match = matchOption(value, opts, (o) => o.textContent ?? '')
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
  isEmpty() {
    return false
  },
}
