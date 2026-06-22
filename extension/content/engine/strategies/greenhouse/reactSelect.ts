// Greenhouse react-select v5 dropdowns (country, EEO/demographic, work-auth, custom
// Yes/No questions). There's no backing native <select>, so we drive the widget: open
// the menu, find the option whose text answers the field, and click it.
//
// Two paths by design. STATIC lists (Yes/No, gender, veteran, disability, country — all
// options preloaded) render on open, so we match against them WITHOUT typing. Typing is
// reserved for ASYNC typeaheads (school, location), passed `fuzzy: true`: only there do we
// type the value to trigger/narrow the remote search. This split matters because typing
// into a static enum would run react-select's substring filter and discard every option
// (e.g. typing the long "No, I do not have a disability" leaves zero matches) — the bug
// behind the "0 options" failures.
//
// Matching layers (see fillReactSelect): an optional `matchText` predicate first (the
// field's per-option matchRe, for EEO wording that differs across ATSes), then the literal
// matchOption tiers, then — for fuzzy fields only — a token-based closest match.

import { wait, fireClick, setNativeValue, log, trunc } from '../../dom'
import { matchOption, closestOption } from '../helpers/optionMatch'
import { pollOptions } from '../helpers/pollOptions'
import { enumOptionMatcher } from '../../semantic'
import { deriveWorkedHere, workedHereRank } from './workedHere'
import { VALUE_DERIVATIONS } from './derive'
import type { FillStrategy } from '../../types'

// Read THIS widget's options only. react-select sets aria-controls to its listbox id
// while open (e.g. "react-select-school--0-listbox"); that's the reliable handle. A
// document-wide fallback is wrong: other react-selects on the page (notably the ~244-entry
// country list) keep their option nodes mounted, so a page-wide [role=option] query reads
// the wrong list and never sees this field's results. When the menu is closed there are no
// options to read — return nothing rather than guess.
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

// The placeholder / loading / empty states render as a node before real options resolve.
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
  /** The chosen option's text (when filled), for logging. */
  shown: string
  /** How many real options we considered, for failure logging. */
  count: number
}

/**
 * Drive one react-select to the option answering `value`. Open the menu, match against
 * the rendered options, and — only for `fuzzy` typeaheads — type the value to trigger the
 * async search and re-match. Shared by the gh-react-select strategy and the education
 * section. `input` is the inner input[role="combobox"].
 *
 * Options:
 *   matchText — predicate for the on-page option text (the field's per-option matchRe),
 *               tried first so EEO wording that differs across ATSes still lands.
 *   rank      — score each option (higher = better); the max positive scorer wins. Used by
 *               worked_here to choose among multi-way employment-status options.
 *   fuzzy     — typeahead field: enables the type-to-search path and an order-independent
 *               closest-token fallback. Off for enum/EEO fields (which stay literal, and
 *               must NOT be typed into — that would filter their short list to nothing).
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
      const s = opts.rank(getText(o))
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

  // Open AND focus — react-select only mounts its listbox (and sets aria-controls, which
  // collectOptions relies on) once the input is focused.
  fireClick(control)
  ;(input as HTMLInputElement).focus()
  await wait(400)

  let options: HTMLElement[]
  let target: HTMLElement | undefined

  if (opts.fuzzy && typeof value === 'string') {
    // Typeahead (school, city): type FIRST to filter, then match. The on-open list is huge
    // and rendered as an alphabetical window (the target may not be in it yet), so matching
    // it directly produces wrong fuzzy hits. Typing the value narrows to the relevant set.
    typeQuery(value)
    options = await pollOptions(() => collectOptions(input), isRealOption, { maxMs: 2500 })
    target = pick(options)

    // Over-specific query (e.g. "Purdue University - West Lafayette" when options read
    // "Purdue University-West Lafayette, IN") can filter to nothing — retry with the first
    // two distinctive words, then closest-match within that broader set.
    if (!target) {
      const short = value.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2).join(' ')
      if (short && short.toLowerCase() !== value.toLowerCase()) {
        typeQuery(short)
        options = await pollOptions(() => collectOptions(input), isRealOption, { maxMs: 2500 })
        target = pick(options)
      }
    }
  } else {
    // Static list (enums, country): all options render on open — match without typing.
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

// Roles backed by an async typeahead react-select (options load remotely only after you
// type), not a preloaded static list. These need the type-to-search + closest-match path,
// same as the education School field.
const TYPEAHEAD_ROLES = new Set(['city'])

export const reactSelectStrategy: FillStrategy = {
  widget: 'gh-react-select',
  priority: 50,
  async fill(field, ctx) {
    let value: string | boolean | null
    const opts: { matchText?: (t: string) => boolean; rank?: (t: string) => number; fuzzy?: boolean } = {}

    if (field.role === 'worked_here') {
      // Derived: compute employment state from the question's company + the user's history,
      // then rank the (often multi-way) options — "I have not worked here" vs previous/
      // current employee/contractor. value is the bool only for skip-check + logging.
      const state = deriveWorkedHere(field.handle, ctx.req)
      if (!state) return [{ role: field.role, status: 'skipped', detail: 'no company parsed' }]
      value = state.worked
      opts.rank = workedHereRank(state)
    } else {
      // Derived-from-résumé roles (degree_pursuing, grad_date) compute their value; the
      // rest read the stored value by role.
      value = VALUE_DERIVATIONS[field.role]?.(ctx.req) ?? ctx.req.values[field.role]
      // For string-enum fields, match the on-page option via the field's per-option matchRe.
      if (typeof value === 'string') opts.matchText = enumOptionMatcher(field.role, value) ?? undefined
      // Async typeahead (city/location): type the value to load remote options, then match.
      if (TYPEAHEAD_ROLES.has(field.role)) opts.fuzzy = true
    }

    if (value === null || value === undefined || value === '') {
      return [{ role: field.role, status: 'skipped', detail: 'no value' }]
    }
    log(`${field.role} detected (gh react-select)`)

    const r = await fillReactSelect(field.handle, value, opts)
    if (r.filled) {
      log(`${field.role} filled ✓ = "${trunc(r.shown)}"`)
      return [{ role: field.role, status: 'filled' }]
    }

    const shown = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value
    log(`${field.role} skipped — no option matched "${shown}" (${r.count} options)`)
    return [{ role: field.role, status: 'failed', detail: 'no option' }]
  },
}
