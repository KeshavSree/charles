// Plain text inputs / textareas + native <select> — shared across ATSes.
//   detect: every text-like control except those housed inside a custom dropdown
//           (react-select inner input). The runtime's claimed-subtree check additionally
//           excludes inputs inside a combobox container claimed by an earlier widget.
//   label:  combined attribute signals (so rules match id/name as well as the visible label).
//   fill:   native value set + React-friendly events (fillInput); native-select sets .value.
// Ported from the old text/native-select strategies + the detectors' text pass + review.

import { fillInput, log, trunc } from '../dom'
import { attrText } from '../helpers/labels'
import type { Widget, Candidate } from '../types'

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio'])

// react-select / aria comboboxes wrap a real <input>; setting .value on it corrupts the
// widget, so never treat those as plain text.
function isCustomHoused(el: Element): boolean {
  return el.getAttribute('role') === 'combobox' || el.closest('[class*="select__control"]') !== null
}

export const textWidget: Widget = {
  name: 'text',
  priority: 10,
  detect(doc) {
    const out: Candidate[] = []
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
      if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return
      if (isCustomHoused(el)) return
      out.push({ handle: el })
    })
    return out
  },
  label(c) {
    return attrText(c.handle)
  },
  async fill(c, input) {
    const el = c.handle as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    const value = input.value
    if (typeof value !== 'string' || !value) {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    try {
      if (el instanceof HTMLSelectElement) {
        el.value = value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        fillInput(el, value)
      }
      log(`${input.field} filled ✓ = "${trunc(value)}"`)
      return [{ role: input.field, status: 'filled' }]
    } catch {
      log(`${input.field} skipped — fill error`)
      return [{ role: input.field, status: 'failed' }]
    }
  },
  isEmpty(c) {
    return !((c.handle as HTMLInputElement).value ?? '').trim()
  },
}
