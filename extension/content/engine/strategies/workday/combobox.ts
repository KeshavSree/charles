// Workday custom select widgets (country/state): click to open, pick the option.
// Pass-1 text filling deliberately skips these (the detector tags them wd-combobox)
// because setting .value directly breaks their async search.

import { wait, log, trunc } from '../../dom'
import type { FillStrategy } from '../../types'

export const comboboxStrategy: FillStrategy = {
  widget: 'wd-combobox',
  priority: 40,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (typeof value !== 'string' || !value) {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (combobox)`)
    const container = field.handle

    // Trigger: prefer selectWidget, fall back to first button in the container.
    const trigger =
      container.querySelector<HTMLElement>('[data-automation-id="selectWidget"]') ??
      container.querySelector<HTMLElement>('button')
    if (!trigger) {
      log(`${field.role} skipped — no dropdown trigger`)
      return [{ role: field.role, status: 'skipped', detail: 'no trigger' }]
    }

    trigger.click()
    await wait(400)

    // Options vary by Workday form version — try selectors in specificity order.
    let options = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
    if (options.length === 0) {
      options = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'))
    }
    if (options.length === 0) {
      options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter((el) => !el.getAttribute('data-automation-id'))
    }

    // If nothing rendered, try typing into the search input to trigger filtering.
    if (options.length === 0) {
      const searchInput =
        container.querySelector<HTMLInputElement>('input') ??
        document.querySelector<HTMLInputElement>('input[data-automation-id="searchBox"]')
      if (searchInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(searchInput, value)
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(500)
        options = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'))
        if (options.length === 0) options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      }
    }

    const val = value.toLowerCase()
    const match =
      options.find((o) => (o.textContent ?? '').trim().toLowerCase() === val) ??
      options.find((o) => (o.textContent ?? '').trim().toLowerCase().startsWith(val)) ??
      options.find((o) => val.startsWith((o.textContent ?? '').trim().toLowerCase().replace(/\s+/g, ' ')))

    if (match) {
      match.click()
      await wait(100)
      log(`${field.role} filled ✓ = "${trunc(value)}"`)
      return [{ role: field.role, status: 'filled' }]
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    log(`${field.role} skipped — no option matched "${value}" (${options.length} options)`)
    return [{ role: field.role, status: 'failed', detail: 'no option' }]
  },
}
