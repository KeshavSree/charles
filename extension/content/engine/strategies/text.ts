// Plain text inputs / textareas, and native <select> elements.

import { fillInput, log, trunc } from '../dom'
import type { FillStrategy } from '../types'

export const textStrategy: FillStrategy = {
  widget: 'text',
  priority: 10,
  async fill(field, ctx) {
    log(`${field.role} detected (text)`)
    const value = ctx.req.values[field.role]
    if (typeof value !== 'string' || !value) {
      log(`${field.role} skipped — no stored value`)
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    try {
      fillInput(field.handle as HTMLInputElement | HTMLTextAreaElement, value)
      log(`${field.role} filled ✓ = "${trunc(value)}"`)
      return [{ role: field.role, status: 'filled' }]
    } catch {
      log(`${field.role} skipped — fill error`)
      return [{ role: field.role, status: 'failed' }]
    }
  },
}

export const nativeSelectStrategy: FillStrategy = {
  widget: 'native-select',
  priority: 10,
  async fill(field, ctx) {
    log(`${field.role} detected (select)`)
    const value = ctx.req.values[field.role]
    if (typeof value !== 'string' || !value) {
      log(`${field.role} skipped — no stored value`)
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    const el = field.handle as HTMLSelectElement
    try {
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      log(`${field.role} filled ✓ = "${trunc(value)}"`)
      return [{ role: field.role, status: 'filled' }]
    } catch {
      log(`${field.role} skipped — fill error`)
      return [{ role: field.role, status: 'failed' }]
    }
  },
}
