// Post-fill review: a page-wide scan for empty fields. After fills run, walk EVERY widget's
// detect() for the current ATS — not just the catalog-matched fields — and report each
// candidate whose widget.isEmpty() is true, by its on-page question text. This surfaces
// unanswered questions the engine has no mapping for (freeform/custom questions) alongside
// ones it recognized but couldn't fill. Empty fields are outlined on the page: amber = we
// had an answer that didn't land; red = needs your answer.

import { markField } from './dom'
import { displayLabel } from './helpers/labels'
import type { Widget, Candidate } from './types'

function containerOf(handle: HTMLElement): Element {
  return handle.closest('[data-automation-id^="formField"]') ?? handle
}

function questionText(c: Candidate): string {
  const el = c.handle
  return displayLabel(el) || el.getAttribute('name') || el.id || '(unlabeled field)'
}

/**
 * Scan the page for empty fields via the widget layer. `widgets` are the current ATS's
 * widgets (registry order); `attempted` maps a detected field's handle to whether we had a
 * value for it (→ amber vs red). Returns the question text of every empty field (`unanswered`)
 * and the amber subset we had an answer for (`didntLand`).
 */
export function runReview(
  widgets: Widget[],
  attempted: Map<HTMLElement, boolean>,
): { unanswered: string[]; didntLand: string[] } {
  const claimed: HTMLElement[] = []
  const markedContainers = new Set<Element>()
  const seenLabels = new Set<string>()
  const unanswered: string[] = []
  const didntLand: string[] = []

  for (const widget of widgets) {
    for (const c of widget.detect(document)) {
      // Greedy dedup: skip a candidate already covered by an earlier (container) widget — so
      // e.g. a react-select isn't also reported via its inner text input. Container widgets
      // precede text/checkbox in registry order, so the correct widget's isEmpty is used.
      if (claimed.some((h) => h === c.handle || h.contains(c.handle))) continue
      claimed.push(c.handle)
      if (!widget.isEmpty(c)) continue

      const container = containerOf(c.handle)
      if (markedContainers.has(container)) continue
      markedContainers.add(container)

      const label = questionText(c)
      const hadValue = attempted.get(c.handle) === true
      markField(
        container as HTMLElement,
        hadValue ? 'amber' : 'red',
        hadValue ? 'had your answer but couldn’t fill this — check it' : 'needs your answer',
      )
      if (hadValue) didntLand.push(label)
      if (!seenLabels.has(label)) { seenLabels.add(label); unanswered.push(label) }
    }
  }

  return { unanswered, didntLand }
}
