// A group of mutually-exclusive checkboxes that behaves like a single-select
// (e.g. Workday's disability self-ID). The stored enum value is matched against each
// checkbox's label; clicking the match selects it (Workday clears the others).

import { log, trunc } from '../../dom'
import { controlLabel } from '../helpers/controlLabel'
import { matchOption } from '../helpers/optionMatch'
import type { FillStrategy } from '../../types'

export const checkboxGroupStrategy: FillStrategy = {
  widget: 'wd-checkbox-group',
  priority: 25,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (typeof value !== 'string' || !value) {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (checkbox group)`)

    const boxes = Array.from(field.handle.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const target = matchOption(value, boxes, (cb) => controlLabel(cb))

    if (!target) {
      log(`${field.role} skipped — no option matched "${value}"`)
      return [{ role: field.role, status: 'failed', detail: 'no option' }]
    }
    if (!target.checked) {
      target.click()
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    log(`${field.role} filled ✓ = "${trunc(controlLabel(target))}"`)
    return [{ role: field.role, status: 'filled' }]
  },
}
