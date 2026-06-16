// Standalone boolean checkboxes — toggle to match the stored value.

import { log } from '../dom'
import type { FillStrategy } from '../types'

export const checkboxStrategy: FillStrategy = {
  widget: 'checkbox',
  priority: 30,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (typeof value !== 'boolean') {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (checkbox)`)
    const cb = field.handle as HTMLInputElement
    try {
      if (value === true && !cb.checked) {
        cb.click()
        cb.dispatchEvent(new Event('change', { bubbles: true }))
        log(`${field.role} filled ✓ = checked`)
        return [{ role: field.role, status: 'filled' }]
      }
      if (value === false && cb.checked) {
        cb.click()
        cb.dispatchEvent(new Event('change', { bubbles: true }))
        log(`${field.role} filled ✓ = unchecked`)
        return [{ role: field.role, status: 'filled' }]
      }
      log(`${field.role} already set`)
      return [{ role: field.role, status: 'filled' }]
    } catch {
      log(`${field.role} skipped — click error`)
      return [{ role: field.role, status: 'failed' }]
    }
  },
}
