// Résumé-derived field values, computed once when the popup builds the fill request (they
// need only the parsed education, not the live DOM). The engine then fills them like any
// stored value via req.values. worked_here is the exception — it needs the question's
// company from the DOM, so it stays a fill-time resolve on its registry leaf.
// Ported from the old greenhouse/derive.ts.

import type { EducationEntry } from './types'

// Most-recent education entry = lowest display_order (the popup sorts ascending).
function latestEducation(education: EducationEntry[]): EducationEntry | null {
  if (!education.length) return null
  return [...education].sort((a, b) => a.display_order - b.display_order)[0]
}

/**
 * "What degree are you currently pursuing?" — classify the résumé's most-recent degree into
 * a canonical option value matching degree_pursuing's catalog options. Null if none.
 */
export function deriveDegreePursuing(education: EducationEntry[]): string | null {
  const degree = latestEducation(education)?.degree?.trim()
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
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * "When do you expect to graduate?" — the most-recent education's actual grad month + year as
 * a full "Month YYYY" (e.g. "May 2028"), so it lands directly on a per-month dropdown. Falls
 * back to the year alone when no month is parsed; null if there's no grad year.
 */
export function deriveGradDate(education: EducationEntry[]): string | null {
  const edu = latestEducation(education)
  const year = edu?.grad_year?.trim()
  if (!year) return null
  const m = edu?.grad_month ? MONTHS[edu.grad_month.slice(0, 3).toLowerCase()] : undefined
  return m ? `${MONTH_NAMES[m - 1]} ${year}` : year
}
