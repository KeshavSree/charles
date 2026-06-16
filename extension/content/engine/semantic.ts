// Semantic role detection: "what does this field mean?" → a role key.
// Reuses the FIELDS registry directly (real RegExp, no serialization) — this is
// the portable, mostly ATS-agnostic half of detection.

import { FIELDS } from '../../../frontend/lib/fields'

interface Rule {
  re: RegExp
  exclude?: RegExp
  key: string
}

// Ordered rule list, built once. Mirrors the original classifyRules exactly:
// every text field's classifyRe in FIELDS order, with the computed `full_name`
// rule injected right after `last_name` (earlier rules win).
const RULES: Rule[] = (() => {
  const rules: Rule[] = []
  for (const f of FIELDS) {
    if (f.classifyRe && f.type === 'text') {
      rules.push({
        re: new RegExp(f.classifyRe, 'i'),
        exclude: f.classifyExcludeRe ? new RegExp(f.classifyExcludeRe, 'i') : undefined,
        key: f.fillKey ?? f.key,
      })
    }
    if (f.key === 'last_name') rules.push({ re: /\bfull.?name\b/i, key: 'full_name' })
  }
  return rules
})()

/** Classify a form element into a role key, or null if nothing matches. */
export function classifyRole(el: Element): string | null {
  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase()
  const name = (el.getAttribute('name') ?? '').toLowerCase()
  const id = (el.id ?? '').toLowerCase()
  const placeholder = (el.getAttribute('placeholder') ?? '').toLowerCase()
  const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase()
  const automationId = (el.closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? '').toLowerCase()

  let labelText = ''
  if (el.id) {
    labelText = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.toLowerCase() ?? ''
  }
  if (!labelText) {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) labelText = document.getElementById(labelledBy)?.textContent?.toLowerCase() ?? ''
  }
  if (!labelText) {
    labelText = el.closest('label')?.textContent?.toLowerCase() ?? ''
  }

  const all = [autocomplete, name, id, placeholder, ariaLabel, automationId, labelText].join(' ')

  // One hardcoded special case: full_name via HTML autocomplete/name semantics.
  if (autocomplete === 'name' || name === 'name') return 'full_name'

  for (const rule of RULES) {
    if (rule.re.test(all)) {
      if (rule.exclude && rule.exclude.test(all)) continue
      return rule.key
    }
  }
  return null
}

/** Lowercased combined label text for a radio/checkbox group element (group label matching). */
export function groupLabelText(el: Element): string {
  return (el.textContent ?? '').toLowerCase()
}
