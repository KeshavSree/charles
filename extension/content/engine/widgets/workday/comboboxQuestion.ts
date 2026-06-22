// A Workday dropdown identified by its QUESTION TEXT (group rules), not a fixed aid — e.g.
// "Would you consider relocating?" rendered as a select. Excludes radio/checkbox-rendered
// questions. Ported from the old wd-combobox-question strategy + the detector's pass + review.

import { wait, log, trunc } from '../../dom'
import { matchOption } from '../../helpers/optionMatch'
import { openDropdown, dismissDropdown } from '../../helpers/workdayDropdown'
import type { Widget, Candidate } from '../../types'

export const comboboxQuestionWidget: Widget = {
  name: 'comboboxQuestion',
  priority: 45,
  detect(doc) {
    const triggers = new Set<HTMLElement>()
    doc.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"], [data-automation-id="selectWidget"]').forEach((t) => triggers.add(t))
    doc.querySelectorAll<HTMLElement>('[data-automation-id^="formField"] button').forEach((t) => triggers.add(t))
    const seen = new Set<Element>()
    const out: Candidate[] = []
    for (const trigger of triggers) {
      const container = trigger.closest<HTMLElement>('[data-automation-id^="formField"]') ?? trigger.parentElement
      if (!container || seen.has(container)) continue
      if (container.querySelector('input[type="radio"], input[type="checkbox"]')) continue
      seen.add(container)
      out.push({ handle: container })
    }
    return out
  },
  label(c) {
    return (c.handle.textContent ?? '').toLowerCase()
  },
  async fill(c, input) {
    const value = input.value
    if (value === null || value === undefined || value === '') {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    const options = await openDropdown(c.handle)
    if (options === null) {
      log(`${input.field} skipped — no dropdown trigger`)
      return [{ role: input.field, status: 'skipped', detail: 'no trigger' }]
    }
    const target = matchOption(value, options, (o) => o.textContent ?? '')
    if (target) {
      target.click()
      await wait(100)
      log(`${input.field} filled ✓ = "${trunc((target.textContent ?? '').trim())}"`)
      return [{ role: input.field, status: 'filled' }]
    }
    dismissDropdown()
    const shown = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value
    log(`${input.field} skipped — no option matched "${shown}" (${options.length} options)`)
    return [{ role: input.field, status: 'failed', detail: 'no option' }]
  },
  isEmpty(c) {
    const btn = c.handle.querySelector('[data-automation-id="selectWidget"], button')
    const t = (btn?.textContent ?? '').trim()
    return t === '' || /^select( one)?$/i.test(t)
  },
}
