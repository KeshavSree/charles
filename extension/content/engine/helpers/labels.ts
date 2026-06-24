// Label / text resolution shared by widget modules. These answer "what text should a
// leaf rule match against?": combined attribute signals for plain inputs (attrText), and
// the broadly-resolved question label for choice widgets (fieldLabel and friends).
// Moved verbatim from the old semantic.ts.

/**
 * Combined, lowercased text signals for a form control — what classify-style rules match
 * against: autocomplete, name, id, placeholder, aria-label, the Workday data-automation-id,
 * and the resolved label text. Used by the plain-text widget's label().
 */
export function attrText(el: Element): string {
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

  return [autocomplete, name, id, placeholder, ariaLabel, automationId, labelText].join(' ')
}

/** Lowercased combined label text for a radio/checkbox group element (group label matching). */
export function groupLabelText(el: Element): string {
  return (el.textContent ?? '').toLowerCase()
}

/**
 * Resolve an element's question/label text, lowercased, from the broadest set of sources:
 * aria-labelledby → aria-label → label[for=id] → wrapping <label> → an ancestor's
 * label/legend/heading. Greenhouse forms vary in how they attach a question label, so
 * narrow resolution silently misses fields. Returns '' if nothing.
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

/** A react-select combobox input's question label. Delegates to fieldLabel. */
export function reactSelectLabel(input: Element): string {
  return fieldLabel(input)
}

/**
 * Best human-readable question/label for a detected element, for DISPLAY in the popup
 * (case-preserved, whitespace-collapsed, length-capped). Unlike fieldLabel (lowercased, for
 * matching), this targets the question a user would read: aria-labelledby → aria-label →
 * label[for] → the enclosing fieldset's legend (grouped choice questions) → wrapping label →
 * placeholder. Returns '' when nothing resolves (callers fall back to the field's catalog label).
 */
export function displayLabel(el: Element): string {
  const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
  const cap = (s: string): string => (s.length > 70 ? `${s.slice(0, 67)}…` : s)

  const lby = el.getAttribute('aria-labelledby')
  if (lby) {
    const t = clean(lby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '))
    if (t) return cap(t)
  }
  const aria = clean(el.getAttribute('aria-label'))
  if (aria) return cap(aria)
  if (el.id) {
    const t = clean(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent)
    if (t) return cap(t)
  }
  const legend = clean(el.closest('fieldset')?.querySelector('legend')?.textContent)
  if (legend) return cap(legend)
  const wrap = clean(el.closest('label')?.textContent)
  if (wrap) return cap(wrap)
  const ph = clean(el.getAttribute('placeholder'))
  if (ph) return cap(ph)
  return ''
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
