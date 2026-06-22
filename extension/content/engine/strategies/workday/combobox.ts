// Workday custom select widgets (country/state): click to open, pick the option.
// Pass-1 text filling deliberately skips these (the detector tags them wd-combobox)
// because setting .value directly breaks their async search.

import { wait, log, trunc } from '../../dom'
import { matchOption } from '../helpers/optionMatch'
import { openDropdown, collectWorkdayOptions, dismissDropdown } from '../helpers/workdayDropdown'
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

    let options = await openDropdown(container)
    if (options === null) {
      log(`${field.role} skipped — no dropdown trigger`)
      return [{ role: field.role, status: 'skipped', detail: 'no trigger' }]
    }

    // If nothing rendered, try typing into the search input to trigger filtering, then
    // re-read the (now async-loaded) options.
    if (options.length === 0) {
      const searchInput =
        container.querySelector<HTMLInputElement>('input') ??
        document.querySelector<HTMLInputElement>('input[data-automation-id="searchBox"]')
      if (searchInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(searchInput, value)
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(500)
        options = collectWorkdayOptions()
      }
    }

    const match = matchOption(value, options, (o) => o.textContent ?? '')
    if (match) {
      match.click()
      await wait(100)
      log(`${field.role} filled ✓ = "${trunc(value)}"`)
      return [{ role: field.role, status: 'filled' }]
    }

    dismissDropdown()
    log(`${field.role} skipped — no option matched "${value}" (${options.length} options)`)
    return [{ role: field.role, status: 'failed', detail: 'no option' }]
  },
}
