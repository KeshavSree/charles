// Value derivations for Greenhouse react-select questions whose answer comes from the
// résumé rather than a stored UserInfo value. Each returns the canonical value the
// reactSelect strategy then matches against the on-page options (via the field's
// per-option matchRe, or matchOption for free-form values), or null to skip.

import type { FillRequest } from '../../types'

// Most-recent education entry = lowest display_order (popup sorts ascending).
function latestEducation(req: FillRequest) {
  if (!req.education.length) return null
  return [...req.education].sort((a, b) => a.display_order - b.display_order)[0]
}

/**
 * "What degree are you currently pursuing?" — classify the résumé's most-recent education
 * degree into a canonical option value matching degree_pursuing's FIELDS options. Null if
 * there's no education or no degree text.
 */
export function deriveDegreePursuing(req: FillRequest): string | null {
  const degree = latestEducation(req)?.degree?.trim()
  if (!degree) return null
  const d = degree.toLowerCase()
  if (/\bmba\b/.test(d)) return 'MBA'
  if (/ph\.?\s?d|doctor/.test(d)) return 'PhD'
  if (/master|\bm\.?\s?[sa]\b|m\.?eng/.test(d)) return "Master's"
  if (/bachelor|undergrad|\bb\.?\s?[sa]\b/.test(d)) return "Bachelor's"
  return 'Other'
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * "When do you expect to graduate?" — from the most-recent education's grad month+year,
 * normalized to the nearest June/December term (Mar–Aug → June, Sep–Feb → December), e.g.
 * "May 2028" → "June 2028". Falls back to "June" when the month is missing but a year
 * exists. Null if there's no grad year at all.
 */
export function deriveGradDate(req: FillRequest): string | null {
  const edu = latestEducation(req)
  const year = edu?.grad_year?.trim()
  if (!year) return null
  const m = edu?.grad_month ? MONTHS[edu.grad_month.slice(0, 3).toLowerCase()] : undefined
  const term = m === undefined ? 'June' : (m >= 3 && m <= 8 ? 'June' : 'December')
  return `${term} ${year}`
}

/** role → derived value resolver. worked_here is handled separately (it needs ranking). */
export const VALUE_DERIVATIONS: Record<string, (req: FillRequest) => string | null> = {
  degree_pursuing: deriveDegreePursuing,
  grad_date: deriveGradDate,
}
