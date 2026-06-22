// Greenhouse react-select v5 dropdowns (country, EEO/demographic, work-auth, custom Yes/No
// questions, phone country code). No backing native <select>, so we drive the widget: open
// the menu, find the option answering the field, click it.
//
// Two paths by design. STATIC lists (Yes/No, gender, veteran, disability, country, phone
// code — all options preloaded) render on open, so we match WITHOUT typing. Typing is
// reserved for ASYNC typeaheads (school, city), via fuzzy: true. Typing into a static enum
// would run react-select's substring filter and discard every option.
//
// Matching layers (fillReactSelect): an optional matchText predicate first (the field's
// per-option matchRe, for EEO wording that differs across ATSes), then the literal
// matchOption tiers (incl. dial-code stripping, so "United States of America" matches
// "United States +1"), then — for fuzzy fields only — a token-based closest match.
// fillReactSelect is ported verbatim from the old strategy and also drives the education
// section. Value/opts (fuzzy, rank, derived values) arrive from the registry leaf.

import { wait, fireClick, setNativeValue, log, trunc } from '../../dom'
import { matchOption, closestOption } from '../../helpers/optionMatch'
import { pollOptions } from '../../helpers/pollOptions'
import { enumOptionMatcher } from '../../helpers/enumMatch'
import { reactSelectLabel, attrText } from '../../helpers/labels'
import type { Widget } from '../../types'

// Read THIS widget's options only, via the listbox aria-controls points at while open. A
// page-wide [role=option] query is wrong: other react-selects keep their nodes mounted.
function collectOptions(input: HTMLElement): HTMLElement[] {
  const listboxId = input.getAttribute('aria-controls')
  const scope =
    (listboxId && document.getElementById(listboxId)) ||
    input.closest('[class*="select__container"]')?.querySelector<HTMLElement>('[class*="select__menu"]') ||
    null
  if (!scope) return []
  const opts = Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]'))
  return opts.length ? opts : Array.from(scope.querySelectorAll<HTMLElement>('[class*="select__option"]'))
}

function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t === '' || /^select(\.\.\.|$)|^loading|^no option|^type to|^searching/.test(t)
}

const isRealOption = (o: HTMLElement): boolean => !isPlaceholder(o.textContent ?? '')

function realOptions(input: HTMLElement): HTMLElement[] {
  return collectOptions(input).filter(isRealOption)
}

export interface ReactSelectResult {
  filled: boolean
  shown: string
  count: number
}

/**
 * Drive one react-select to the option answering `value`. `input` is the inner
 * input[role="combobox"]. Shared by this widget and the education section.
 */
export async function fillReactSelect(
  input: HTMLElement,
  value: string | boolean,
  opts: { fuzzy?: boolean; matchText?: (text: string) => boolean; rank?: (text: string) => number } = {},
): Promise<ReactSelectResult> {
  const control = input.closest<HTMLElement>('[class*="select__control"]') ?? input
  const getText = (o: HTMLElement) => o.textContent ?? ''
  const byRank = (options: HTMLElement[]): HTMLElement | undefined => {
    if (!opts.rank) return undefined
    let best: HTMLElement | undefined
    let bestScore = 0
    for (const o of options) {
      const s = opts.rank!(getText(o))
      if (s > bestScore) { bestScore = s; best = o }
    }
    return best
  }
  const pick = (options: HTMLElement[]): HTMLElement | undefined =>
    byRank(options) ??
    (opts.matchText ? options.find((o) => opts.matchText!(getText(o))) : undefined) ??
    matchOption(value, options, getText) ??
    (opts.fuzzy && typeof value === 'string' ? closestOption(value, options, getText) : undefined)

  // setNativeValue + a bare 'input' event (NOT fillInput, whose focusout would blur the
  // field and make react-select close the menu and discard the query).
  const typeQuery = (q: string) => {
    setNativeValue(input as HTMLInputElement, q)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Open AND focus — react-select only mounts its listbox (and sets aria-controls) on focus.
  fireClick(control)
  ;(input as HTMLInputElement).focus()
  await wait(400)

  let options: HTMLElement[]
  let target: HTMLElement | undefined

  if (opts.fuzzy && typeof value === 'string') {
    typeQuery(value)
    options = await pollOptions(() => collectOptions(input), isRealOption, { maxMs: 2500 })
    target = pick(options)

    if (!target) {
      const short = value.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2).join(' ')
      if (short && short.toLowerCase() !== value.toLowerCase()) {
        typeQuery(short)
        options = await pollOptions(() => collectOptions(input), isRealOption, { maxMs: 2500 })
        target = pick(options)
      }
    }
  } else {
    options = realOptions(input)
    if (!options.length) options = await pollOptions(() => collectOptions(input), isRealOption, { maxMs: 1200 })
    target = pick(options)
  }

  if (target) {
    fireClick(target)
    await wait(100)
    return { filled: true, shown: (target.textContent ?? '').trim(), count: options.length }
  }

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  return { filled: false, shown: '', count: options.length }
}

export const reactSelectWidget: Widget = {
  name: 'dropdown',
  priority: 50,
  detect(doc) {
    return Array.from(doc.querySelectorAll<HTMLInputElement>('input[role="combobox"]')).map((el) => ({ handle: el }))
  },
  // Combine the question label (group rules) with the input's attribute text (so country/city
  // still match on id/name as the old classifyRole did).
  label(c) {
    return `${reactSelectLabel(c.handle)} ${attrText(c.handle)}`
  },
  async fill(c, input) {
    const value = input.value
    if (value === null || value === undefined || value === '') {
      return [{ role: input.field, status: 'skipped', detail: 'no value' }]
    }
    // string-enum fields match the on-page option via the field's per-option matchRe.
    const matchText = typeof value === 'string' ? (enumOptionMatcher(input.field, value) ?? undefined) : undefined
    const r = await fillReactSelect(c.handle, value, { fuzzy: input.opts.fuzzy, rank: input.opts.rank, matchText })
    if (r.filled) {
      log(`${input.field} filled ✓ = "${trunc(r.shown)}"`)
      return [{ role: input.field, status: 'filled' }]
    }
    const shown = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value
    log(`${input.field} skipped — no option matched "${shown}" (${r.count} options)`)
    return [{ role: input.field, status: 'failed', detail: 'no option' }]
  },
  isEmpty(c) {
    const control = c.handle.closest('[class*="select__control"]') ?? c.handle
    const t = (control.querySelector('[class*="single-value"]')?.textContent ?? '').trim()
    return t === '' || /^select/i.test(t)
  },
}
