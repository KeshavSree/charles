// Resolve a form control's visible label text — shared by the radio-group and
// checkbox-group strategies, which match a stored value against each option's label.
// Resolution order: label[for=id] → wrapping <label> → aria-labelledby → aria-label.
// Returns the trimmed label (NOT lowercased — callers lowercase as needed). When
// `fallbackValue` is set and nothing else resolves, falls back to an input's own `value`.
export function controlLabel(el: HTMLElement, opts: { fallbackValue?: boolean } = {}): string {
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (l?.textContent?.trim()) return l.textContent.trim()
  }
  const wrap = el.closest('label')
  if (wrap?.textContent?.trim()) return wrap.textContent.trim()
  const lb = el.getAttribute('aria-labelledby')
  if (lb) {
    const e = document.getElementById(lb)
    if (e?.textContent?.trim()) return e.textContent.trim()
  }
  const aria = el.getAttribute('aria-label')
  if (aria?.trim()) return aria.trim()
  if (opts.fallbackValue && el instanceof HTMLInputElement) return el.value ?? ''
  return ''
}
