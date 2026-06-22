// For a string-enum field, build a predicate that matches the on-page option text for the
// stored `value`, using that option's `matchRe` from the catalog. Decouples the stored
// canonical value from each ATS's wording (e.g. "No, I do not have a disability" matching
// "No, I don't have a disability"). Returns null when there's no field/option/matchRe —
// callers then fall back to literal text matching. Moved verbatim from the old semantic.ts.

import { FIELDS } from '../../../../frontend/lib/fields'

export function enumOptionMatcher(role: string, value: string): ((text: string) => boolean) | null {
  const field = FIELDS.find((f) => (f.fillKey ?? f.key) === role || f.key === role)
  const opt = field?.options?.find((o) => o.value === value)
  if (!opt?.matchRe) return null
  const re = new RegExp(opt.matchRe, 'i')
  return (text: string) => re.test(text.trim())
}
