// Standalone boolean checkboxes — shared across ATSes (privacy consent, single acks).
//   detect: every checkbox (mutually-exclusive enum checkbox groups are claimed first by
//           the wd-checkbox-group widget, so the runtime's claimed-subtree check skips them).
//   label:  the checkbox's name/id/aria/label plus the broad fieldLabel (catches a group
//           heading above an acknowledgement checkbox, e.g. privacy consent).
//   fill:   toggle to match the stored bool.
// Ported from the old checkbox strategy + the detectors' standalone-checkbox pass + review.

import { log } from '../dom'
import { fieldLabel } from '../helpers/labels'
import type { Widget } from '../types'

export const checkboxWidget: Widget = {
  name: 'checkbox',
  priority: 30,
  detect(doc) {
    return Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map((cb) => ({ handle: cb }))
  },
  label(c) {
    const cb = c.handle as HTMLInputElement
    return [
      cb.getAttribute('name') ?? '',
      cb.id,
      cb.getAttribute('aria-label') ?? '',
      cb.id ? document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.textContent ?? '' : '',
      cb.closest('label')?.textContent ?? '',
      fieldLabel(cb),
    ].join(' ').toLowerCase()
  },
  async fill(c, input) {
    const value = input.value
    if (typeof value !== 'boolean') {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    const cb = c.handle as HTMLInputElement
    try {
      if (value === true && !cb.checked) {
        cb.click()
        cb.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (value === false && cb.checked) {
        cb.click()
        cb.dispatchEvent(new Event('change', { bubbles: true }))
      }
      log(`${input.field} filled ✓ = ${value ? 'checked' : 'unchecked'}`)
      return [{ role: input.field, status: 'filled' }]
    } catch {
      log(`${input.field} skipped — click error`)
      return [{ role: input.field, status: 'failed' }]
    }
  },
  isEmpty(c) {
    return !(c.handle as HTMLInputElement).checked
  },
}
