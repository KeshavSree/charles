// Post-fill review pass: after the strategies run, look at the FORM'S OWN STATE
// (empty + required) — independent of our hooks — and flag what still needs attention.
// This catches both fields we recognized-but-didn't-fill AND questions we have no hook
// for at all. Outlines them on the page (two colors) and returns labels for the popup.

import { markField } from './dom'
import type { DetectedField, FillRequest } from './types'

// --- Heuristics: the two likely tweak points after seeing a real form. ---

/** Required if Workday marks aria-required, or the field label carries a '*'. */
function isRequired(container: Element): boolean {
  if (container.querySelector('[aria-required="true"]')) return true
  const labelish = container.querySelector('label, [data-automation-id*="label" i]')
  const text = labelish?.textContent ?? container.textContent ?? ''
  return text.includes('*')
}

/** Whether a recognized field is still empty, by widget type. */
function isEmpty(handle: HTMLElement, widget: string): boolean {
  switch (widget) {
    case 'text':
    case 'native-select':
      return !((handle as HTMLInputElement).value ?? '').trim()
    case 'radio-group': {
      const radios =
        handle instanceof HTMLInputElement && handle.name
          ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(handle.name)}"]`))
          : Array.from(handle.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      return !radios.some((r) => r.checked)
    }
    case 'checkbox':
      return !(handle as HTMLInputElement).checked
    case 'wd-combobox':
    case 'wd-combobox-question': {
      const btn = handle.querySelector('[data-automation-id="selectWidget"], button')
      const t = (btn?.textContent ?? '').trim()
      return t === '' || /^select( one)?$/i.test(t)
    }
    case 'wd-multiselect':
      return !handle.closest('[data-automation-id="multiSelectContainer"]')?.querySelector('[data-automation-id="selectedItem"]')
    case 'gh-react-select': {
      // Empty when the control shows no chosen value (no single-value node, or it still
      // reads the "Select…" placeholder). handle is the combobox input.
      const control = handle.closest('[class*="select__control"]') ?? handle
      const t = (control.querySelector('[class*="single-value"]')?.textContent ?? '').trim()
      return t === '' || /^select/i.test(t)
    }
    default:
      return false // sections, file upload — not meaningfully "empty"
  }
}

/** Generic emptiness for an arbitrary formField container (the unknown-question scan). */
function isEmptyContainer(ff: Element): boolean {
  for (const el of Array.from(ff.querySelectorAll<HTMLInputElement>('input, textarea, select'))) {
    if (el.type === 'radio' || el.type === 'checkbox') {
      if (el.checked) return false
    } else if ((el.value ?? '').trim()) {
      return false
    }
  }
  const btn = ff.querySelector('[data-automation-id="selectWidget"], button[aria-haspopup]')
  if (btn) {
    const t = (btn.textContent ?? '').trim()
    if (t && !/^select( one)?$/i.test(t)) return false
  }
  if (ff.querySelector('[data-automation-id="selectedItem"]')) return false
  return true
}

function containerOf(handle: HTMLElement): Element {
  return handle.closest('[data-automation-id^="formField"]') ?? handle
}

function labelOf(ff: Element): string {
  const text = (ff.querySelector('label')?.textContent ?? ff.textContent ?? '').trim()
  return text.slice(0, 60) || (ff.getAttribute('data-automation-id') ?? 'field')
}

export function runReview(detected: DetectedField[], req: FillRequest): { needsYou: string[]; didntLand: string[] } {
  const expectedNonEmpty = new Set(
    Object.entries(req.values).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k]) => k),
  )

  // Amber: we had your answer, but the field is still empty (a fill that didn't take).
  const didntLand: string[] = []
  const amberContainers = new Set<Element>()
  for (const f of detected) {
    if (!expectedNonEmpty.has(f.role)) continue
    if (!isEmpty(f.handle, f.widget)) continue
    const container = containerOf(f.handle)
    if (amberContainers.has(container)) continue
    markField(container as HTMLElement, 'amber', 'had your answer but couldn’t fill this — check it')
    amberContainers.add(container)
    didntLand.push(f.role)
  }

  // Red: required, empty, and not ours — unknown questions or ones you left blank.
  const needsYou: string[] = []
  for (const ff of Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id^="formField"]'))) {
    if (amberContainers.has(ff)) continue
    if (!isRequired(ff)) continue
    if (!isEmptyContainer(ff)) continue
    markField(ff, 'red', 'needs your answer')
    needsYou.push(labelOf(ff))
  }

  return { needsYou, didntLand }
}
