// Standalone "Date" calendar field → fill today's date. Workday renders month/day/year
// sub-inputs; parts are filled without focusout except the last, so validation sees a
// complete date. The leaf rule (a predicate) restricts this to a field labelled exactly
// "Date" (or a name="date") so we don't touch "Date of Birth" / experience From-To dates.
// Ported from the old wd-date strategy + the detector's date pass.

import { wait, fillInput, log } from '../../dom'
import type { Widget } from '../../types'

export const dateWidget: Widget = {
  name: 'date',
  priority: 15,
  detect(doc) {
    const seen = new Set<Element>()
    const out: { handle: HTMLElement }[] = []
    for (const m of Array.from(doc.querySelectorAll<HTMLElement>('[data-automation-id$="dateSectionMonth-input"]'))) {
      const ff = m.closest<HTMLElement>('[data-automation-id^="formField"]')
      if (ff && !seen.has(ff)) { seen.add(ff); out.push({ handle: ff }) }
    }
    return out
  },
  label(c) {
    return (c.handle.querySelector('label')?.textContent ?? '').trim().toLowerCase()
  },
  async fill(c, input) {
    const now = new Date()
    const mm = String(now.getMonth() + 1)
    const dd = String(now.getDate())
    const yyyy = String(now.getFullYear())

    const ff = c.handle
    const month = ff.querySelector<HTMLInputElement>('[data-automation-id$="dateSectionMonth-input"]')
    const day = ff.querySelector<HTMLInputElement>('[data-automation-id$="dateSectionDay-input"]')
    const year = ff.querySelector<HTMLInputElement>('[data-automation-id$="dateSectionYear-input"]')
    if (!month && !day && !year) {
      log(`${input.field} skipped — no date sub-inputs found`)
      return [{ role: input.field, status: 'skipped', detail: 'no inputs' }]
    }

    if (month) fillInput(month, mm, false)
    if (day) fillInput(day, dd, false)
    if (year) fillInput(year, yyyy, false)
    const last = year ?? day ?? month
    last?.dispatchEvent(new Event('focusout', { bubbles: true }))
    await wait(150)

    log(`${input.field} filled ✓ = ${mm}/${dd}/${yyyy} (today)`)
    return [{ role: input.field, status: 'filled' }]
  },
  isEmpty() {
    return false
  },
}
