// The dispatcher: the uniform loop tying detectors and strategies together.
//   detect fields → order by widget priority → run each field's strategy → collect.
// It holds no Workday knowledge; that lives in the detector and the strategies.

import { FIELDS } from '../../../frontend/lib/fields'
import { detectAts, detectorFor, WorkdayDetector } from './detectors'
import { STRATEGIES } from './strategies'
import { runReview } from './review'
import { log, wait } from './dom'
import type { FillRequest, FillSummary, FillResult } from './types'

// Roles whose fills are best-guess defaults — reported separately so the user verifies them.
const DOUBLE_CHECK_ROLES = new Set(FIELDS.filter((f) => f.doubleCheck).map((f) => f.fillKey ?? f.key))

export async function run(req: FillRequest, onProgress?: (msg: string) => void): Promise<FillSummary> {
  const progress = onProgress ?? (() => {})

  progress('detector running...')
  const detector = detectorFor(detectAts()) ?? WorkdayDetector
  const fields = detector.detectFields(document)

  // Order by the widget's strategy priority: cheap/synchronous first, async/click last.
  const ordered = fields
    .map((f) => ({ f, p: STRATEGIES.get(f.widget)?.priority ?? 999 }))
    .sort((a, b) => a.p - b.p)
    .map((x) => x.f)

  progress(`filling ${ordered.length} field(s)...`)
  const results: FillResult[] = []
  for (const field of ordered) {
    const strategy = STRATEGIES.get(field.widget)
    if (!strategy) continue
    try {
      results.push(...(await strategy.fill(field, { req, log })))
    } catch (e) {
      log(`${field.role} (${field.widget}) error — ${e instanceof Error ? e.message : 'unknown'}`)
      results.push({ role: field.role, status: 'failed' })
    }
  }

  const allFilled = Array.from(new Set(results.filter((r) => r.status === 'filled').map((r) => r.role)))
  const filled = results.filter((r) => r.status === 'filled').length

  // Split filled roles: defaults go to double-check, everything else to filled.
  const doubleCheckFields = allFilled.filter((r) => DOUBLE_CHECK_ROLES.has(r))
  const filledFields = allFilled.filter((r) => !DOUBLE_CHECK_ROLES.has(r))

  // Expected data = non-empty request values (mirrors the old allDataKeys). A value
  // we have but couldn't place (no field on the page, or a failed fill) shows as skipped.
  const expectedKeys = Object.entries(req.values)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k]) => k)
  const skippedFields = expectedKeys.filter((k) => !allFilled.includes(k))

  // Post-fill review: let the DOM settle, then outline what still needs attention.
  progress('reviewing...')
  await wait(400)
  const { needsYou, didntLand } = runReview(fields, req)

  log(`done — ${filled} filled | filled: [${filledFields.join(', ')}] | double-check: [${doubleCheckFields.join(', ')}] | skipped: [${skippedFields.join(', ')}] | needs-you: ${needsYou.length} | didn't-land: ${didntLand.length}`)
  return { filled, skipped: skippedFields.length, filledFields, skippedFields, doubleCheckFields, needsYou, didntLand }
}
