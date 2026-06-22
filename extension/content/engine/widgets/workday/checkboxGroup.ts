// A group of mutually-exclusive checkboxes behaving like a single-select (e.g. Workday's
// disability self-ID). The stored enum value is matched against each checkbox's label;
// clicking the match selects it (Workday clears the others). Ported from the old
// wd-checkbox-group strategy + the detector's checkbox-group pass.

import { log, trunc } from '../../dom'
import { controlLabel } from '../../helpers/controlLabel'
import { matchOption } from '../../helpers/optionMatch'
import type { Widget, Candidate } from '../../types'

export const checkboxGroupWidget: Widget = {
  name: 'checkboxGroup',
  priority: 25,
  detect(doc) {
    const seen = new Set<HTMLElement>()
    const out: Candidate[] = []
    for (const cb of Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      const group = cb.closest<HTMLElement>('fieldset, [role="group"], [data-automation-id$="CheckboxGroup"], [data-automation-id^="formField"]')
      if (!group || seen.has(group)) continue
      if (group.querySelectorAll('input[type="checkbox"]').length < 2) continue
      seen.add(group)
      out.push({ handle: group })
    }
    return out
  },
  label(c) {
    return (c.handle.textContent ?? '').toLowerCase()
  },
  async fill(c, input) {
    const value = input.value
    if (typeof value !== 'string' || !value) {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    const boxes = Array.from(c.handle.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const target = matchOption(value, boxes, (cb) => controlLabel(cb))
    if (!target) {
      log(`${input.field} skipped — no option matched "${value}"`)
      return [{ role: input.field, status: 'failed', detail: 'no option' }]
    }
    if (!target.checked) {
      target.click()
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    log(`${input.field} filled ✓ = "${trunc(controlLabel(target))}"`)
    return [{ role: input.field, status: 'filled' }]
  },
  // The old review pass had no checkbox-group branch (default: not "empty").
  isEmpty() {
    return false
  },
}
