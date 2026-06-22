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

/**
 * For a string-enum field, a predicate that matches the on-page option text for the
 * stored `value`, using that option's `matchRe`. This decouples the stored canonical
 * value from each ATS's wording (e.g. "No, I do not have a disability" matching
 * Greenhouse's "No, I don't have a disability"). Returns null when there's no field,
 * option, or matchRe — callers then fall back to literal text matching.
 */
export function enumOptionMatcher(role: string, value: string): ((text: string) => boolean) | null {
  const field = FIELDS.find((f) => (f.fillKey ?? f.key) === role || f.key === role)
  const opt = field?.options?.find((o) => o.value === value)
  if (!opt?.matchRe) return null
  const re = new RegExp(opt.matchRe, 'i')
  return (text: string) => re.test(text.trim())
}

// --- Radio/checkbox group roles (ATS-agnostic) ---
// Group fields (work_authorized, gender, disability, …) are matched by a label regex
// rather than per-input semantics. Shared by every detector that recognizes grouped
// choice questions; built once from the FIELDS registry's groupRe.

export interface GroupField {
  re: RegExp
  role: string
  /** bool fields render as a single checkbox; string-enum fields as a radio/checkbox set. */
  isBool: boolean
}

export const GROUP_FIELDS: GroupField[] = FIELDS
  .filter((f) => f.groupRe)
  .map((f) => ({ re: new RegExp(f.groupRe as string, 'i'), role: f.key, isBool: f.type === 'bool' }))

/** Roles only filled when the user's aggressive-fill toggle is on (FIELDS `aggressive`). */
export const AGGRESSIVE_ROLES = new Set(FIELDS.filter((f) => f.aggressive).map((f) => f.fillKey ?? f.key))

/**
 * Resolve an element's question/label text, lowercased, from the broadest set of sources:
 * aria-labelledby → aria-label → label[for=id] → wrapping <label> → an ancestor's
 * label/legend/heading. Greenhouse forms vary in how they attach a question label (some
 * use aria-labelledby="<id>-label", others a label[for] or a heading above a checkbox
 * group), so narrow resolution silently misses fields (e.g. #race, the privacy checkbox).
 * Mirrors the scanner's fullLabel in docs/greenhouse-unfilled.js. Returns '' if nothing.
 */
export function fieldLabel(el: Element): string {
  const lby = el.getAttribute('aria-labelledby')
  if (lby) {
    const t = lby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    if (t) return t.toLowerCase()
  }
  const aria = el.getAttribute('aria-label')
  if (aria?.trim()) return aria.trim().toLowerCase()
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (lbl?.textContent?.trim()) return lbl.textContent.trim().toLowerCase()
  }
  const wrap = el.closest('label')
  if (wrap?.textContent?.trim()) return wrap.textContent.trim().toLowerCase()
  let node = el.parentElement
  for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
    const lab = node.querySelector('label, legend, [class*="label" i]')
    if (lab && lab !== el && lab.textContent?.trim()) return lab.textContent.trim().toLowerCase()
  }
  return ''
}

/**
 * A react-select combobox input's question label. Delegates to fieldLabel (the broad
 * resolver). Shared by the Greenhouse detector (groupRe matching) and the worked-here
 * derivation (which parses the company out of the label).
 */
export function reactSelectLabel(input: Element): string {
  return fieldLabel(input)
}

/** Combined group label for a set of radios (legend → role group aria → name). */
export function getGroupLabel(radios: HTMLInputElement[]): string {
  for (const r of radios) {
    const legend = r.closest('fieldset')?.querySelector('legend')
    if (legend?.textContent) return legend.textContent.toLowerCase()
  }
  for (const r of radios) {
    const container = r.closest('[role="group"],[role="radiogroup"]')
    if (container) {
      const labelledBy = container.getAttribute('aria-labelledby')
      if (labelledBy) {
        const text = document.getElementById(labelledBy)?.textContent
        if (text) return text.toLowerCase()
      }
      const ariaLabel = container.getAttribute('aria-label')
      if (ariaLabel) return ariaLabel.toLowerCase()
    }
  }
  if (radios[0]?.name) return radios[0].name.toLowerCase()
  return ''
}
