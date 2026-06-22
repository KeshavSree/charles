// A Workday dropdown whose answer is identified by the QUESTION TEXT (groupRe),
// not by a fixed automation-id. Fuses two existing pieces: question-text matching
// (like the radio yes/no questions) + the combobox open/pick mechanics (like State).
//
// Bool value → pick the option starting with "Yes"/"No" (handles verbose labels like
// "Yes, I would consider relocating for this role"). Enum value → match option text.

import { wait, log, trunc } from '../../dom'
import { matchOption } from '../helpers/optionMatch'
import { openDropdown, dismissDropdown } from '../helpers/workdayDropdown'
import type { FillStrategy } from '../../types'

export const comboboxQuestionStrategy: FillStrategy = {
  widget: 'wd-combobox-question',
  priority: 45,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (value === null || value === undefined || value === '') {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (combobox question)`)

    const options = await openDropdown(field.handle)
    if (options === null) {
      log(`${field.role} skipped — no dropdown trigger`)
      return [{ role: field.role, status: 'skipped', detail: 'no trigger' }]
    }

    const target = matchOption(value, options, (o) => o.textContent ?? '')
    if (target) {
      target.click()
      await wait(100)
      log(`${field.role} filled ✓ = "${trunc((target.textContent ?? '').trim())}"`)
      return [{ role: field.role, status: 'filled' }]
    }

    dismissDropdown()
    const shown = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value
    log(`${field.role} skipped — no option matched "${shown}" (${options.length} options)`)
    return [{ role: field.role, status: 'failed', detail: 'no option' }]
  },
}
