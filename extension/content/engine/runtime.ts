// The generic engine loop. Detect → match → fill → review, driven entirely by the REGISTRY.
// Holds no ATS or widget knowledge: that lives in registry.ts (the map) and the widget
// modules (detect/fill/isEmpty). Replaces the old dispatcher.ts.

import { FIELDS } from '../../../frontend/lib/fields'
import { REGISTRY } from './registry'
import { runReview, type ReviewItem } from './reviewPass'
import { log, wait } from './dom'
import type { Ats, Candidate, FieldRule, FillInput, FillRequest, FillResult, FillSummary, LeafRule, Widget } from './types'

// The seam where each ATS plugs in: map the current frame's hostname to an ATS key. With
// allFrames injection this runs per-frame, so an ATS form in a cross-origin iframe resolves
// from inside that iframe (where location.hostname is the real form's host).
function detectAts(): Ats | null {
  const h = location.hostname
  if (h.includes('myworkdayjobs.com')) return 'workday'
  if (h.includes('greenhouse.io')) return 'greenhouse'
  return null
}

// Roles whose fills are best-guess defaults — reported separately so the user verifies them.
const DOUBLE_CHECK_ROLES = new Set(FIELDS.filter((f) => f.doubleCheck).map((f) => f.fillKey ?? f.key))
// Roles only filled when the user's aggressive-fill toggle is on.
const AGGRESSIVE_ROLES = new Set(FIELDS.filter((f) => f.aggressive).map((f) => f.fillKey ?? f.key))

function asRule(rule: LeafRule): FieldRule {
  return rule instanceof RegExp ? { match: rule } : rule
}

function ruleMatches(rule: FieldRule, label: string, c: Candidate): boolean {
  const ok = typeof rule.match === 'function' ? rule.match(label, c) : rule.match.test(label)
  if (!ok) return false
  if (rule.exclude && rule.exclude.test(label)) return false
  if (rule.reject && rule.reject(c)) return false
  return true
}

interface Detected {
  field: string
  widget: Widget
  candidate: Candidate
  input: FillInput
}

export async function run(req: FillRequest, onProgress?: (msg: string) => void): Promise<FillSummary> {
  const progress = onProgress ?? (() => {})

  progress('detector running...')
  const ats = detectAts()
  const leaves = ats ? REGISTRY[ats] : undefined

  // Detection: walk widgets in registry order. Each widget finds its candidates, which we
  // match to a field by the leaf's rules (first match wins, honoring exclude/reject). A
  // claimed-subtree set dedupes: once an element (or a container holding it) is taken, later
  // widgets skip it — this is what keeps a react-select's inner input or a combobox's text
  // box out of the plain-text widget (those widgets are listed earlier in the registry).
  const detected: Detected[] = []
  const claimed: HTMLElement[] = []
  if (leaves) {
    for (const widgetName of Object.keys(leaves)) {
      const leaf = leaves[widgetName]
      for (const c of leaf.widget.detect(document)) {
        if (claimed.some((h) => h === c.handle || h.contains(c.handle))) continue
        const label = leaf.widget.label(c)
        let field: string | null = null
        for (const key of Object.keys(leaf.fields)) {
          if (ruleMatches(asRule(leaf.fields[key]), label, c)) { field = key; break }
        }
        if (!field) continue
        claimed.push(c.handle)
        const rule = asRule(leaf.fields[field])
        let value: string | boolean | null
        let opts = rule.fillOpts ?? {}
        if (rule.resolve) {
          const r = rule.resolve(c, req)
          value = r.value
          if (r.opts) opts = { ...opts, ...r.opts }
        } else {
          value = req.values[field] ?? null
        }
        detected.push({ field, widget: leaf.widget, candidate: c, input: { field, value, opts } })
      }
    }
  }

  // Fill: order by widget priority (cheap/sync before async/click-driven). Aggressive gate
  // mirrors the old dispatcher.
  const ordered = [...detected].sort((a, b) => a.widget.priority - b.widget.priority)
  progress(`filling ${ordered.length} field(s)...`)
  const results: FillResult[] = []
  for (const d of ordered) {
    if (AGGRESSIVE_ROLES.has(d.field) && !req.aggressive) {
      results.push({ role: d.field, status: 'skipped', detail: 'aggressive off' })
      continue
    }
    try {
      results.push(...(await d.widget.fill(d.candidate, d.input, { req, log })))
    } catch (e) {
      log(`${d.field} (${d.widget.name}) error — ${e instanceof Error ? e.message : 'unknown'}`)
      results.push({ role: d.field, status: 'failed' })
    }
  }

  // Summary — identical shape/logic to the old dispatcher.
  const allFilled = Array.from(new Set(results.filter((r) => r.status === 'filled').map((r) => r.role)))
  const filled = results.filter((r) => r.status === 'filled').length
  const doubleCheckFields = allFilled.filter((r) => DOUBLE_CHECK_ROLES.has(r))
  const filledFields = allFilled.filter((r) => !DOUBLE_CHECK_ROLES.has(r))
  const expectedKeys = Object.entries(req.values)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k]) => k)
  const skippedFields = expectedKeys.filter((k) => !allFilled.includes(k))

  progress('reviewing...')
  await wait(400)
  const reviewItems: ReviewItem[] = detected.map((d) => ({ role: d.field, widget: d.widget, candidate: d.candidate }))
  const { needsYou, didntLand } = runReview(reviewItems, req)

  log(`done — ${filled} filled | filled: [${filledFields.join(', ')}] | double-check: [${doubleCheckFields.join(', ')}] | skipped: [${skippedFields.join(', ')}] | needs-you: ${needsYou.length} | didn't-land: ${didntLand.length}`)
  return { filled, skipped: skippedFields.length, filledFields, skippedFields, doubleCheckFields, needsYou, didntLand }
}
