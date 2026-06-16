// A group of mutually-exclusive checkboxes that behaves like a single-select
// (e.g. Workday's disability self-ID). The stored enum value is matched against each
// checkbox's label; clicking the match selects it (Workday clears the others).

import { log, trunc } from '../../dom'
import type { FillStrategy } from '../../types'

function labelOf(cb: HTMLInputElement): string {
  if (cb.id) {
    const l = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)
    if (l?.textContent) return l.textContent.trim()
  }
  const parent = cb.closest('label')
  if (parent?.textContent) return parent.textContent.trim()
  const lb = cb.getAttribute('aria-labelledby')
  if (lb) {
    const e = document.getElementById(lb)
    if (e?.textContent) return e.textContent.trim()
  }
  return cb.getAttribute('aria-label') ?? ''
}

export const checkboxGroupStrategy: FillStrategy = {
  widget: 'wd-checkbox-group',
  priority: 25,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (typeof value !== 'string' || !value) {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (checkbox group)`)

    const val = value.toLowerCase()
    const boxes = Array.from(field.handle.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const target = boxes.find((cb) => {
      const t = labelOf(cb).toLowerCase()
      return t === val || t.startsWith(val)
    })

    if (!target) {
      log(`${field.role} skipped — no option matched "${value}"`)
      return [{ role: field.role, status: 'failed', detail: 'no option' }]
    }
    if (!target.checked) {
      target.click()
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    log(`${field.role} filled ✓ = "${trunc(labelOf(target))}"`)
    return [{ role: field.role, status: 'filled' }]
  },
}
