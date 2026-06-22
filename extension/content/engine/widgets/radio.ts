// Radio groups — shared across ATSes.
//   detect: bucket radios by name, one candidate per group (handle = group container/first).
//   label:  the group's question label (legend/role-group aria/name).
//   fill:   bool values match Yes/No (label or value); enum values match the option label.
// Ported from the old radio-group strategy + the detectors' radio grouping + review.

import { log } from '../dom'
import { getGroupLabel } from '../helpers/labels'
import { controlLabel } from '../helpers/controlLabel'
import type { Widget, Candidate } from '../types'

function collectRadios(handle: HTMLElement): HTMLInputElement[] {
  if (handle instanceof HTMLInputElement && handle.type === 'radio') {
    if (handle.name) {
      return Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(handle.name)}"]`))
    }
    return [handle]
  }
  return Array.from(handle.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
}

function matchesBoolValue(text: string, storedTrue: boolean): boolean {
  if (storedTrue) return /\byes\b|\b1\b|\btrue\b/.test(text)
  return /\bno\b|\b0\b|\bfalse\b/.test(text)
}

export const radioWidget: Widget = {
  name: 'radio',
  priority: 20,
  detect(doc) {
    const groups = new Map<string, HTMLInputElement[]>()
    doc.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => {
      const key = r.name || r.id || Math.random().toString()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    })
    const out: Candidate[] = []
    groups.forEach((radios) => {
      const handle = radios[0].closest<HTMLElement>('[role="radiogroup"],[role="group"],fieldset') ?? radios[0]
      out.push({ handle })
    })
    return out
  },
  label(c) {
    return getGroupLabel(collectRadios(c.handle))
  },
  async fill(c, input) {
    const value = input.value
    if (value === null || value === undefined || value === '') {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    const radios = collectRadios(c.handle)

    let target: HTMLInputElement | null = null
    for (const radio of radios) {
      const radioLabel = controlLabel(radio, { fallbackValue: true }).toLowerCase()
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
        log(`${input.field} filled ✓ = ${value}`)
        return [{ role: input.field, status: 'filled' }]
      } catch {
        log(`${input.field} skipped — click error`)
        return [{ role: input.field, status: 'failed' }]
      }
    }
    if (!target) {
      log(`${input.field} skipped — no radio option matched ${value}`)
      return [{ role: input.field, status: 'skipped', detail: 'no match' }]
    }
    log(`${input.field} already set = ${value}`)
    return [{ role: input.field, status: 'filled' }]
  },
  isEmpty(c) {
    return !collectRadios(c.handle).some((r) => r.checked)
  },
}
