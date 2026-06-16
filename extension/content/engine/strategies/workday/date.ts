// Standalone "Date" calendar field → fill today's date. Workday renders it as
// month/day/year sub-inputs (same dateSection widget as the From/To fields). Parts are
// filled without focusout; only the last is blurred so validation sees a complete date.

import { wait, fillInput, log } from '../../dom'
import type { FillStrategy } from '../../types'

export const dateStrategy: FillStrategy = {
  widget: 'wd-date',
  priority: 15,
  async fill(field, _ctx) {
    const now = new Date()
    const mm = String(now.getMonth() + 1)
    const dd = String(now.getDate())
    const yyyy = String(now.getFullYear())

    const c = field.handle
    const month = c.querySelector<HTMLInputElement>('[data-automation-id$="dateSectionMonth-input"]')
    const day = c.querySelector<HTMLInputElement>('[data-automation-id$="dateSectionDay-input"]')
    const year = c.querySelector<HTMLInputElement>('[data-automation-id$="dateSectionYear-input"]')

    if (!month && !day && !year) {
      log(`${field.role} skipped — no date sub-inputs found`)
      return [{ role: field.role, status: 'skipped', detail: 'no inputs' }]
    }

    if (month) fillInput(month, mm, false)
    if (day) fillInput(day, dd, false)
    if (year) fillInput(year, yyyy, false)
    // Blur the last present part to commit/validate the whole date.
    const last = year ?? day ?? month
    last?.dispatchEvent(new Event('focusout', { bubbles: true }))
    await wait(150)

    log(`${field.role} filled ✓ = ${mm}/${dd}/${yyyy} (today)`)
    return [{ role: field.role, status: 'filled' }]
  },
}
