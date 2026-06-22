// Workday custom select widgets (country/state): click to open, pick the option. Matched by
// the container's data-automation-id (the registry leaf carries aid patterns). Ported from
// the old wd-combobox strategy + the detector's combobox pass + review.

import { wait, log, trunc } from '../../dom'
import { matchOption } from '../../helpers/optionMatch'
import { openDropdown, collectWorkdayOptions, dismissDropdown } from '../../helpers/workdayDropdown'
import type { Widget, Candidate } from '../../types'

export const comboboxWidget: Widget = {
  name: 'combobox',
  priority: 40,
  detect(doc) {
    const seen = new Set<HTMLElement>()
    const out: Candidate[] = []
    doc.querySelectorAll<HTMLElement>('[data-automation-id="selectWidget"]').forEach((w) => {
      const container = w.closest<HTMLElement>('[data-automation-id^="formField"]') ?? w.parentElement
      if (container && !seen.has(container)) { seen.add(container); out.push({ handle: container }) }
    })
    return out
  },
  label(c) {
    return (c.handle.getAttribute('data-automation-id') ?? '').toLowerCase()
  },
  async fill(c, input) {
    const value = input.value
    if (typeof value !== 'string' || !value) {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    const container = c.handle
    let options = await openDropdown(container)
    if (options === null) {
      log(`${input.field} skipped — no dropdown trigger`)
      return [{ role: input.field, status: 'skipped', detail: 'no trigger' }]
    }
    // If nothing rendered, type into the search input to trigger filtering, then re-read.
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
      log(`${input.field} filled ✓ = "${trunc(value)}"`)
      return [{ role: input.field, status: 'filled' }]
    }
    dismissDropdown()
    log(`${input.field} skipped — no option matched "${value}" (${options.length} options)`)
    return [{ role: input.field, status: 'failed', detail: 'no option' }]
  },
  isEmpty(c) {
    const btn = c.handle.querySelector('[data-automation-id="selectWidget"], button')
    const t = (btn?.textContent ?? '').trim()
    return t === '' || /^select( one)?$/i.test(t)
  },
}
