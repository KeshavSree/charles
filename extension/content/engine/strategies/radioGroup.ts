// Radio groups. Bool values match Yes/No; enum values match the option label exactly.

import { log } from '../dom'
import { controlLabel } from './helpers/controlLabel'
import type { FillStrategy } from '../types'

const getRadioLabel = (radio: HTMLInputElement): string =>
  controlLabel(radio, { fallbackValue: true }).toLowerCase()

function matchesBoolValue(labelOrVal: string, storedTrue: boolean): boolean {
  if (storedTrue) return /\byes\b|\b1\b|\btrue\b/.test(labelOrVal)
  return /\bno\b|\b0\b|\bfalse\b/.test(labelOrVal)
}

// handle is the group container (preferred) or a lone radio; rebuild the group.
function collectRadios(handle: HTMLElement): HTMLInputElement[] {
  if (handle instanceof HTMLInputElement && handle.type === 'radio') {
    if (handle.name) {
      return Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(handle.name)}"]`))
    }
    return [handle]
  }
  return Array.from(handle.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
}

export const radioGroupStrategy: FillStrategy = {
  widget: 'radio-group',
  priority: 20,
  async fill(field, ctx) {
    const value = ctx.req.values[field.role]
    if (value === null || value === undefined || value === '') {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (radio group)`)
    const radios = collectRadios(field.handle)

    let target: HTMLInputElement | null = null
    for (const radio of radios) {
      const radioLabel = getRadioLabel(radio)
      const radioVal = (radio.value ?? '').toLowerCase()
      if (typeof value === 'boolean') {
        if (matchesBoolValue(radioLabel, value) || matchesBoolValue(radioVal, value)) { target = radio; break }
      } else {
        const stored = String(value).toLowerCase()
        if (radioLabel === stored || radioVal === stored) { target = radio; break }
      }
    }

    if (target && !target.checked) {
      try {
        target.click()
        target.dispatchEvent(new Event('change', { bubbles: true }))
        log(`${field.role} filled ✓ = ${value}`)
        return [{ role: field.role, status: 'filled' }]
      } catch {
        log(`${field.role} skipped — click error`)
        return [{ role: field.role, status: 'failed' }]
      }
    }
    if (!target) {
      log(`${field.role} skipped — no radio option matched ${value}`)
      return [{ role: field.role, status: 'skipped', detail: 'no match' }]
    }
    log(`${field.role} already set = ${value}`)
    return [{ role: field.role, status: 'filled' }]
  },
}
