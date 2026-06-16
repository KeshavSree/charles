// A Workday dropdown whose answer is identified by the QUESTION TEXT (groupRe),
// not by a fixed automation-id. Fuses two existing pieces: question-text matching
// (like the radio yes/no questions) + the combobox open/pick mechanics (like State).
//
// Bool value → pick the option starting with "Yes"/"No" (handles verbose labels like
// "Yes, I would consider relocating for this role"). Enum value → match option text.

import { wait, log, trunc } from '../../dom'
import type { FillStrategy } from '../../types'

function matches(value: string | boolean): (text: string) => boolean {
  if (typeof value === 'boolean') {
    // ^yes\b / ^no\b so "No, I am not able…" matches but "Not sure" / "I am local…" don't.
    const re = value ? /^yes\b/i : /^no\b/i
    return (t) => re.test(t.trim())
  }
  const val = value.toLowerCase()
  return (t) => {
    const tt = t.trim().toLowerCase()
    return tt === val || tt.startsWith(val)
  }
}

export const comboboxQuestionStrategy: FillStrategy = {
  widget: 'wd-combobox-question',
  priority: 45,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (value === null || value === undefined || value === '') {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (combobox question)`)

    const container = field.handle
    const trigger =
      container.querySelector<HTMLElement>('[data-automation-id="selectWidget"]') ??
      container.querySelector<HTMLElement>('button')
    if (!trigger) {
      log(`${field.role} skipped — no dropdown trigger`)
      return [{ role: field.role, status: 'skipped', detail: 'no trigger' }]
    }

    trigger.click()
    await wait(400)

    let options = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
    if (options.length === 0) options = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'))
    if (options.length === 0) options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter((el) => !el.getAttribute('data-automation-id'))

    const want = matches(value)
    const target = options.find((o) => want(o.textContent ?? ''))

    if (target) {
      target.click()
      await wait(100)
      log(`${field.role} filled ✓ = "${trunc((target.textContent ?? '').trim())}"`)
      return [{ role: field.role, status: 'filled' }]
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    const shown = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value
    log(`${field.role} skipped — no option matched "${shown}" (${options.length} options)`)
    return [{ role: field.role, status: 'failed', detail: 'no option' }]
  },
}
