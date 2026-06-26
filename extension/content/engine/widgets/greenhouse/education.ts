// Greenhouse education section: a repeatable block per entry. School (#school--N, an async
// typeahead) and Degree (#degree--N, a dropdown) are filled by id. Some forms add more fields
// (Discipline/Major dropdown, Start/End date month+year) whose ids we can't see — those are
// matched by LABEL within the entry's scope. Entry 0 is pre-rendered; later ones need "Add".
// Start date isn't stored on the résumé profile (only graduation/end), so it's left blank.

import { wait, fireClick, fillInput, log, trunc } from '../../dom'
import { fillReactSelect } from './reactSelect'
import { fieldLabel } from '../../helpers/labels'
import type { Widget, FillResult } from '../../types'

// Resume parsers emit terse degree tokens ("B.S.", "Bachelor of Science", "PhD"). Reduce to
// the leading degree keyword, which startsWith-matches the dropdown options. Check specific
// first; unrecognized values pass through to the matcher's fuzzy tiers.
function mapDegree(d: string): string {
  const t = d.trim()
  if (/\b(doctor|ph\.?\s*d)/i.test(t)) return 'Doctor'
  if (/\b(master|mba|m\.?\s*[sab])\b/i.test(t)) return 'Master'
  if (/\b(bachelor|b\.?\s*[sa])\b/i.test(t)) return 'Bachelor'
  if (/\bassociate/i.test(t)) return 'Associate'
  return t
}

// The "Add another" control lives inside the education section; find it by walking up from
// the first school input and matching a button/link whose text contains "add".
function findAddButton(): HTMLElement | null {
  const school = document.querySelector<HTMLElement>('input[id^="school--"]')
  let node: Element | null = school?.parentElement ?? null
  for (let k = 0; k < 12 && node; k++, node = node.parentElement) {
    const btn = Array.from(node.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
      .find((b) => /\badd\b/i.test(b.textContent ?? ''))
    if (btn) return btn
  }
  return null
}

async function fillSelect(tag: string, id: string, value: string, results: FillResult[]): Promise<void> {
  const el = document.getElementById(id)
  if (!el) { log(`${tag} skipped — #${id} not found`); return }
  // School/Degree are searched; phrasing rarely matches the stored value verbatim, so fuzzy.
  const r = await fillReactSelect(el, value, { fuzzy: true })
  if (r.filled) {
    log(`${tag} filled ✓ = "${trunc(r.shown)}"`)
    results.push({ role: 'education', status: 'filled' })
  } else {
    log(`${tag} failed — no option matched "${value}" (${r.count} options)`)
    results.push({ role: 'education', status: 'failed' })
  }
}

// The entry's container = the smallest ancestor holding both school--N and degree--N. The
// extra fields (Discipline, date dropdowns) are matched by label within this scope so we don't
// depend on their (unknown) ids, and we don't reach into a sibling entry or another section.
function entryScope(idx: number): HTMLElement | null {
  const school = document.getElementById(`school--${idx}`)
  if (!school) return null
  const degree = document.getElementById(`degree--${idx}`)
  if (degree) {
    let node: HTMLElement | null = school
    while (node && !node.contains(degree)) node = node.parentElement
    if (node) return node
  }
  return school.parentElement
}

// A react-select in the entry that isn't the school/degree one.
const isExtraSelect = (el: Element) => !/^(school|degree)--/.test(el.id)

// Discipline ≈ Major: a react-select labelled discipline/major/field of study (fuzzy, like school).
async function fillDiscipline(scope: HTMLElement, value: string, tag: string, results: FillResult[]): Promise<void> {
  const el = Array.from(scope.querySelectorAll<HTMLElement>('input[role="combobox"]'))
    .find((c) => isExtraSelect(c) && /discipline|major|field of study|concentration|area of study/i.test(fieldLabel(c)))
  if (!el) return
  const r = await fillReactSelect(el, value, { fuzzy: true })
  log(`${tag}.discipline ${r.filled ? 'filled ✓' : 'failed'} = "${trunc(value)}"`)
  results.push({ role: 'education', status: r.filled ? 'filled' : 'failed' })
}

// End-date month (dropdown: react-select or native <select>) + year (free text). Start date is
// not stored on the profile, so it's intentionally skipped.
async function fillEndDate(scope: HTMLElement, month: string | null, year: string | null, tag: string, results: FillResult[]): Promise<void> {
  const yearRe = /\bend\b.{0,15}\byear\b|graduat\w*.{0,15}year|completion.{0,15}year/i
  const monthRe = /\bend\b.{0,15}\bmonth\b|graduat\w*.{0,15}month|completion.{0,15}month/i

  if (year) {
    const yEl = Array.from(scope.querySelectorAll<HTMLInputElement>('input'))
      .find((c) => c.type !== 'hidden' && c.getAttribute('role') !== 'combobox' && yearRe.test(fieldLabel(c)))
    if (yEl) { fillInput(yEl, year); log(`${tag}.endYear filled ✓ = "${year}"`); results.push({ role: 'education', status: 'filled' }) }
  }

  if (month) {
    const rs = Array.from(scope.querySelectorAll<HTMLElement>('input[role="combobox"]'))
      .find((c) => isExtraSelect(c) && monthRe.test(fieldLabel(c)))
    if (rs) {
      const r = await fillReactSelect(rs, month, {})
      log(`${tag}.endMonth ${r.filled ? 'filled ✓' : 'failed'} = "${month}"`)
      results.push({ role: 'education', status: r.filled ? 'filled' : 'failed' })
      return
    }
    const sel = Array.from(scope.querySelectorAll<HTMLSelectElement>('select')).find((s) => monthRe.test(fieldLabel(s)))
    if (sel) {
      const m = month.toLowerCase()
      const opt = Array.from(sel.options).find((o) =>
        o.text.trim().toLowerCase() === m || o.text.trim().toLowerCase().startsWith(m) || o.value.toLowerCase() === m)
      if (opt) {
        sel.value = opt.value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        log(`${tag}.endMonth filled ✓ = "${month}"`)
        results.push({ role: 'education', status: 'filled' })
      }
    }
  }
}

export const educationWidget: Widget = {
  name: 'education',
  priority: 55,
  detect(doc) {
    const school = doc.querySelector<HTMLElement>('input[id^="school--"]')
    return school ? [{ handle: school }] : []
  },
  label() {
    return 'education'
  },
  async fill(_c, _input, ctx) {
    const entries = ctx.req.education
    if (!entries.length) return []
    const results: FillResult[] = []

    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx]
      const tag = `education[${idx}]`

      // Ensure the block exists; entry 0 is pre-rendered, later ones need an Add click.
      if (!document.getElementById(`school--${idx}`)) {
        const addBtn = findAddButton()
        if (!addBtn) { log(`${tag} skipped — no Add button`); results.push({ role: 'education', status: 'skipped' }); continue }
        log(`${tag} adding entry`)
        fireClick(addBtn)
        await wait(600)
      }
      if (!document.getElementById(`school--${idx}`)) {
        log(`${tag} skipped — block didn't appear`)
        results.push({ role: 'education', status: 'skipped' })
        continue
      }

      if (entry.institution) await fillSelect(`${tag}.school`, `school--${idx}`, entry.institution, results)
      if (entry.degree) await fillSelect(`${tag}.degree`, `degree--${idx}`, mapDegree(entry.degree), results)

      // Extra fields (Discipline/Major, End date) matched by label within the entry scope.
      const scope = entryScope(idx)
      if (scope) {
        if (entry.major) await fillDiscipline(scope, entry.major, tag, results)
        await fillEndDate(scope, entry.grad_month, entry.grad_year, tag, results)
      }
      await wait(200)
    }

    return results
  },
  isEmpty() {
    return false
  },
}
