// Shared option matcher for custom dropdown widgets (Workday comboboxes, Greenhouse
// react-selects). Given a stored value and a list of rendered option elements, pick
// the one that answers the field. Two cases, both case-insensitive:
//
//   boolean — a yes/no question. Match the option whose text STARTS WITH "Yes"/"No",
//             so verbose labels like "Yes, I would consider…" hit but "Not sure" /
//             "I am local…" don't.
//   string  — five-tier preference: exact, then startsWith, then a normalized reverse
//             startsWith (the value contains the option text with collapsed spaces), then a
//             dial-code-stripped tier, then a month-term fallback. The reverse tier handles
//             stored values longer/more specific than the on-screen option (e.g. "United
//             States of America" vs "United States"). The dial-code tier handles phone
//             country-code selectors ("United States +1"). The month-term tier handles a
//             "Month YYYY" value (graduation date) against a coarse dropdown that only lists
//             June/December markers — falling back to the nearest 6-month term. Exact still
//             wins, so an every-month dropdown is unaffected.

const MONTHS_IDX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// For a "Month YYYY" value with no exact option, match the nearest June/December term.
function matchMonthTerm<T>(val: string, options: T[], norm: (o: T) => string): T | undefined {
  const m = val.match(/^([a-z]{3,})\s+((?:19|20)\d{2})$/)
  if (!m) return undefined
  const idx = MONTHS_IDX[m[1].slice(0, 3)]
  if (!idx) return undefined
  const target = `${idx >= 3 && idx <= 8 ? 'june' : 'december'} ${m[2]}`
  return options.find((o) => norm(o) === target || norm(o).startsWith(target))
}

/** Pick the option matching `value`, preferring stronger matches. Returns undefined if none. */
export function matchOption<T>(
  value: string | boolean,
  options: T[],
  getText: (o: T) => string,
): T | undefined {
  if (typeof value === 'boolean') {
    const re = value ? /^yes\b/i : /^no\b/i
    return options.find((o) => re.test(getText(o).trim()))
  }
  const val = value.toLowerCase()
  const norm = (o: T) => getText(o).trim().toLowerCase()
  // Strip a trailing phone dial code ("United States +1" → "United States"). Guarded below
  // so it only affects options that actually carried a dial code.
  const stripDial = (s: string) => s.replace(/[\s(]*\+\d.*$/, '').trim()
  return (
    options.find((o) => norm(o) === val) ??
    options.find((o) => norm(o).startsWith(val)) ??
    options.find((o) => val.startsWith(norm(o).replace(/\s+/g, ' '))) ??
    options.find((o) => {
      const s = stripDial(norm(o))
      return s !== norm(o) && (s === val || val.startsWith(s) || s.startsWith(val))
    }) ??
    matchMonthTerm(val, options, norm)
  )
}

// "of", "the" etc. are too common to anchor a match on.
const STOPWORDS = new Set(['the', 'of', 'and', 'at', 'for', 'a', 'an', 'de', 'in'])

// Generic institution words that appear in a huge share of school/employer names. They
// still count toward overlap, but must NOT be the anchor token — otherwise "University"
// alone would let "Purdue University - West Lafayette" match "Arizona State University".
const GENERIC_WORDS = new Set([
  'university', 'college', 'institute', 'institution', 'school', 'state', 'technology',
  'technical', 'community', 'polytechnic', 'academy', 'department', 'campus', 'inc', 'llc',
])

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t && !STOPWORDS.has(t))
}

/**
 * Best-effort "closest" match for search/typeahead widgets, where the stored value and
 * the option phrase the same place differently — order-independent, unlike matchOption's
 * prefix tiers. E.g. "Purdue University - West Lafayette" → an option rendered "Purdue
 * University-West Lafayette, IN". Scores options by how many of the value's tokens they
 * contain, but only among options that include the value's most distinctive token — the
 * longest token that ISN'T a generic institution word like "University"/"State" — so a
 * shared common word can't carry a wrong match. Requires at least 2 overlapping tokens
 * (or a single non-generic token value) so one weak hit can't win. Ties keep the earliest
 * option (typeaheads rank the primary result first). Undefined if nothing meaningfully
 * overlaps. DELIBERATELY not used for enum/EEO fields, where a loose match could pick the
 * wrong sensitive option.
 */
export function closestOption<T>(value: string, options: T[], getText: (o: T) => string): T | undefined {
  const valTokens = tokenize(value)
  if (!valTokens.length) return undefined
  // Anchor on the most distinctive token: longest non-generic one if any, else longest.
  const distinctive = valTokens.filter((t) => !GENERIC_WORDS.has(t))
  const pool = distinctive.length ? distinctive : valTokens
  const keyToken = pool.reduce((a, b) => (b.length > a.length ? b : a))
  const minOverlap = valTokens.length > 1 ? 2 : 1
  let best: T | undefined
  let bestScore = 0
  for (const o of options) {
    const optTokens = new Set(tokenize(getText(o)))
    if (!optTokens.has(keyToken)) continue
    const overlap = valTokens.filter((t) => optTokens.has(t)).length
    if (overlap >= minOverlap && overlap > bestScore) { bestScore = overlap; best = o }
  }
  return best
}
