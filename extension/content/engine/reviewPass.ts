// Post-fill review pass (registry engine). After fills run, look at the form's own state —
// empty + required — independent of our hooks, and flag what still needs attention:
//   amber: we had your answer but the field is still empty (a fill that didn't take).
//   red:   required, empty, and not ours (unknown question / left blank).
// Emptiness is delegated to each widget's isEmpty(); the red scan walks Workday formField
// containers (no-op on Greenhouse, which has none). Ported from the old review.ts.

import { markField } from './dom'
import type { FillRequest, Widget, Candidate } from './types'

export interface ReviewItem {
  role: string
  widget: Widget
  candidate: Candidate
}

/** Required if Workday marks aria-required, or the field label carries a '*'. */
function isRequired(container: Element): boolean {
  if (container.querySelector('[aria-required="true"]')) return true
  const labelish = container.querySelector('label, [data-automation-id*="label" i]')
  const text = labelish?.textContent ?? container.textContent ?? ''
  return text.includes('*')
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

export function runReview(detected: ReviewItem[], req: FillRequest): { needsYou: string[]; didntLand: string[] } {
  const expectedNonEmpty = new Set(
    Object.entries(req.values).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k]) => k),
  )

  // Amber: we had your answer, but the field is still empty (a fill that didn't take).
  const didntLand: string[] = []
  const amberContainers = new Set<Element>()
  for (const f of detected) {
    if (!expectedNonEmpty.has(f.role)) continue
    if (!f.widget.isEmpty(f.candidate)) continue
    const container = containerOf(f.candidate.handle)
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
