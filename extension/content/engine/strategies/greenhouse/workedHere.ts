// Derives the answer to "Have you worked at <company>?" questions (the gh-react-select
// role `worked_here`). Reads the company named in the question label and checks it against
// the user's company list — `req.workedCompanies` (edited on the Info page, seeded from the
// résumé) is authoritative when non-empty so the user can remove a company; otherwise we
// fall back to the résumé experience companies.
//
// These questions aren't always Yes/No — Greenhouse forms often render a multi-way select
// ("I am a previous employee", "current contractor", "I have not worked here", …). So we
// derive a small state {worked, current} and rank the on-page options rather than matching a
// single value: the negative case picks the "have not worked" option; the positive case
// prefers the matching tense (current/previous from the experience entry) and employee over
// contractor, with sensible fallbacks.

import { reactSelectLabel } from '../../semantic'
import type { FillRequest } from '../../types'

export interface WorkedHereState {
  worked: boolean
  /** Tense for the affirmative case — from the matched experience entry's is_current. */
  current: boolean
}

// Pull the company out of phrasings like "have you worked at DoorDash?",
// "were you previously employed at Acme", "are you a former employee of Globex".
function extractCompany(label: string): string | null {
  const m = label.match(/(?:worked\s+(?:at|for)|employee\s+of|employed\s+(?:at|by))\s+(.+)$/i)
  if (!m) return null
  // Drop trailing punctuation / clauses ("…doordash before?" → "doordash").
  const company = m[1].replace(/[?*.!,;:].*$/, '').replace(/\s+(before|previously|in the past)\b.*$/i, '').trim()
  return company || null
}

// Strip case, punctuation and common corporate suffixes so "DoorDash, Inc." matches
// "doordash" and "Acme Technologies" matches "acme".
function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|corp|corporation|co|ltd|limited|technologies|labs|group|holdings)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function companyMatches(a: string, b: string): boolean {
  const x = normalizeCompany(a)
  const y = normalizeCompany(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/** Employment state for the question's company, or null if no company could be parsed. */
export function deriveWorkedHere(handle: HTMLElement, req: FillRequest): WorkedHereState | null {
  const asked = extractCompany(reactSelectLabel(handle))
  if (!asked) return null

  // The edited list is authoritative when present (lets the user remove a company);
  // otherwise derive purely from résumé experience.
  const worked = req.workedCompanies.length
    ? req.workedCompanies.some((c) => companyMatches(c, asked))
    : req.experience.some((e) => companyMatches(e.company, asked))
  if (!worked) return { worked: false, current: false }

  // Tense comes from the experience entry when we have one (the list is names only).
  const expMatch = req.experience.find((e) => companyMatches(e.company, asked))
  return { worked: true, current: expMatch?.is_current ?? false }
}

/**
 * Score an option's text for the derived state (higher = better, 0 = not a candidate).
 * Handles both Yes/No forms and the multi-way employee/contractor × current/previous forms.
 */
export function workedHereRank(state: WorkedHereState): (text: string) => number {
  return (raw: string) => {
    const t = raw.toLowerCase()
    const negative = /\b(?:not|never)\b[^.]*work|did not work|have not worked|^\s*no\b/.test(t)

    if (!state.worked) return negative ? 3 : 0
    if (negative) return 0

    const isCurrent = /\bcurrent/.test(t)
    const isPrevious = /\bprevious|\bformer|\bprior|\bpast\b/.test(t)
    const isEmployee = /employee|full.?time|\bstaff\b/.test(t)
    const isContractor = /contractor|contract|consultant|freelanc/.test(t)

    let score = 0
    if (state.current && isCurrent) score += 4
    else if (!state.current && isPrevious) score += 4
    else if (isCurrent || isPrevious) score += 1 // affirmative but wrong tense
    if (isEmployee) score += 2
    else if (isContractor) score += 1
    // Plain "Yes" / "I have worked here" with no tense/type wording.
    if (score === 0 && (/^\s*yes\b/.test(t) || /have worked|worked (?:at|for|here)/.test(t))) score = 1
    return score
  }
}
