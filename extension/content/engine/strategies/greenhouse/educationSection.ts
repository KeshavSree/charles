// Greenhouse education section: a repeatable block with two react-selects per entry —
// School (#school--N, an async typeahead over a university list) and Degree (#degree--N,
// a dropdown). Entry 0 is pre-rendered; further entries appear after clicking the
// section's "Add" control. Each select is driven by the shared react-select fill.

import { wait, fireClick, log, trunc } from '../../dom'
import { fillReactSelect } from './reactSelect'
import type { FillStrategy, FillResult } from '../../types'

// Resume parsers emit terse degree tokens ("B.S.", "Bachelor of Science", "PhD"). Reduce
// them to the leading degree keyword, which startsWith-matches the dropdown options
// ("Bachelor" → "Bachelor's Degree"). Order matters — check more specific first.
// Unrecognized values pass through and rely on the matcher's fuzzy tiers.
function mapDegree(d: string): string {
  const t = d.trim()
  if (/\b(doctor|ph\.?\s*d)/i.test(t)) return 'Doctor'
  if (/\b(master|mba|m\.?\s*[sab])\b/i.test(t)) return 'Master'
  if (/\b(bachelor|b\.?\s*[sa])\b/i.test(t)) return 'Bachelor'
  if (/\bassociate/i.test(t)) return 'Associate'
  return t
}

// The "Add another" control lives inside the education section; find it by walking up
// from the first school input and matching a button/link whose text contains "add".
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
  // School/Degree are searched, and the option phrasing rarely matches the stored value
  // verbatim ("Purdue University" vs "… — Purdue University"), so allow closest match.
  const r = await fillReactSelect(el, value, { fuzzy: true })
  if (r.filled) {
    log(`${tag} filled ✓ = "${trunc(r.shown)}"`)
    results.push({ role: 'education', status: 'filled' })
  } else {
    log(`${tag} failed — no option matched "${value}" (${r.count} options)`)
    results.push({ role: 'education', status: 'failed' })
  }
}

export const educationSectionStrategy: FillStrategy = {
  widget: 'gh-education-section',
  priority: 55,
  async fill(_field, ctx) {
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
      await wait(200)
    }

    return results
  },
}
