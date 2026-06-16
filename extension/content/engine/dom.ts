// Low-level, ATS-agnostic DOM helpers shared by every strategy.
// Ported verbatim from the original fillPageFields — the behaviors here are
// hard-won (React-friendly events, date-pair blur timing, pointer-sequence clicks).

/** Field-level logging — visible in the page's DevTools console. */
export const log = (msg: string) => console.log(`[charles] ${msg}`)

/** Truncate long values for log readability. */
export const trunc = (v: string) => (v.length > 60 ? `${v.slice(0, 57)}…` : v)

/** Promise-based delay. */
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Set an input/textarea value through the native setter so React's value tracker
 * registers the change (a plain `el.value = x` is swallowed by controlled inputs).
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}

/**
 * Fill a text input/textarea and fire the events React listens for.
 * Uses `focusout` (bubbles) rather than `blur` for synthetic onBlur.
 * `triggerBlur=false` is used for the month of a date pair so validation doesn't
 * fire on an incomplete "08/" before the year is set.
 */
export function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string, triggerBlur = true): void {
  setNativeValue(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (triggerBlur) el.dispatchEvent(new Event('focusout', { bubbles: true }))
}

/**
 * Robust click for React widgets: full pointer + mouse sequence. A bare `.click()`
 * is ignored by some Workday list items (e.g. the skills dropdown menuItem).
 */
export function fireClick(el: HTMLElement): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, view: window }
  el.dispatchEvent(new PointerEvent('pointerdown', init))
  el.dispatchEvent(new MouseEvent('mousedown', init))
  el.dispatchEvent(new PointerEvent('pointerup', init))
  el.dispatchEvent(new MouseEvent('mouseup', init))
  el.dispatchEvent(new MouseEvent('click', init))
}

/** Parse a date string into month/year. Handles both `MM/YYYY` and `YYYY-MM[-DD]`. */
export function parseDateParts(d: string | null): { month: string; year: string } | null {
  if (!d) return null
  if (d.includes('/')) {
    const [m, y] = d.split('/')
    return { month: m ? String(parseInt(m, 10)) : '', year: y || '' }
  }
  const parts = d.split('-')
  return { month: parts[1] ? String(parseInt(parts[1], 10)) : '', year: parts[0] || '' }
}

// The marker is drawn as a positioned ::after border (not `outline`) so each edge can
// be controlled independently — the box hugs the field on top/sides but stops short of
// the bottom (BOTTOM_INSET) to trim the dead space below the input.
const BOTTOM_INSET = 8 // px the box is pulled up from the element's bottom edge

function ensureMarkStyles(): void {
  if (document.getElementById('charles-mark-style')) return
  const style = document.createElement('style')
  style.id = 'charles-mark-style'
  style.textContent = `
    [data-charles-mark]::after {
      content: ''; position: absolute;
      left: -2px; top: -2px; right: -2px; bottom: ${BOTTOM_INSET}px;
      border: 2px solid; border-radius: 4px;
      pointer-events: none; z-index: 2147483646;
    }
    [data-charles-mark="amber"]::after { border-color: #f59e0b; }
    [data-charles-mark="red"]::after   { border-color: #ef4444; }
  `
  document.head.appendChild(style)
}

/**
 * Outline a field on the page so the user can see what still needs attention.
 * amber = "we had your answer but it didn't land"; red = "needs your answer".
 * Persists after the injected run; cleared on page reload.
 */
export function markField(el: HTMLElement, kind: 'amber' | 'red', note: string): void {
  ensureMarkStyles()
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  el.setAttribute('data-charles-mark', kind)
  el.title = `Charles: ${note}`
}

/** Decode a base64 string into a File (used for the resume PDF upload). */
export function base64ToFile(base64: string, filename: string, type = 'application/pdf'): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], filename, { type })
}
