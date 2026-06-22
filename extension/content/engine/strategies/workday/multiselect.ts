// Workday skills multiselect ("monikerSearchBox"). For each skill: prefill + one
// keystroke to fire a single remote search, Enter to commit, poll until real
// (non-placeholder) options render, then click the inner promptOption.

import { wait, fireClick, setNativeValue, log } from '../../dom'
import { pollOptions } from '../helpers/pollOptions'
import type { FillStrategy } from '../../types'

function optionLabel(o: HTMLElement): string {
  const p = o.querySelector('[data-automation-id="promptOption"]')
  return (p?.getAttribute('data-automation-label') ?? p?.textContent ?? o.textContent ?? '').trim()
}

// "No Items.", loading and empty states render as a menuItem before the remote
// search resolves — they are not selectable skills.
function isPlaceholder(label: string): boolean {
  return label === '' || /^no items|^no results|^loading|^searching/i.test(label)
}

// Trigger exactly ONE remote search: silently prefill all but the last character
// (no events → no search), then "type" the final character with a full key+input
// sequence. Avoids the rapid-fire race that overwrites results with a stale "No Items."
async function typeQuery(el: HTMLInputElement, text: string): Promise<void> {
  el.focus()
  el.click()
  const head = text.slice(0, -1)
  const last = text.slice(-1)
  const code = last.toUpperCase().charCodeAt(0)
  setNativeValue(el, head)
  el.dispatchEvent(new KeyboardEvent('keydown', { key: last, keyCode: code, bubbles: true, cancelable: true }))
  el.dispatchEvent(new KeyboardEvent('keypress', { key: last, keyCode: code, bubbles: true, cancelable: true }))
  setNativeValue(el, text)
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: last, inputType: 'insertText' }))
  el.dispatchEvent(new KeyboardEvent('keyup', { key: last, keyCode: code, bubbles: true }))
}

export const multiselectStrategy: FillStrategy = {
  widget: 'wd-multiselect',
  priority: 60,
  async fill(_field, ctx) {
    const skills = ctx.req.skills
    if (!skills.length) return []
    const results: import('../../types').FillResult[] = []

    for (const skill of skills) {
      const el = document.getElementById('skills--skills') as HTMLInputElement | null
      if (!el) { log('skills skipped — input #skills--skills not found'); break }
      log(`skill "${skill}" detected (searching)`)
      await typeQuery(el, skill)
      // Enter commits the query and kicks off the remote search.
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
      el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }))
      await wait(600)

      const opts = await pollOptions(
        () => Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="menuItem"][role="option"]')),
        (o) => !isPlaceholder(optionLabel(o)),
        { maxMs: 3000, stepMs: 300 },
      )
      const first = opts[0] ?? null
      if (!first) {
        log(`skill "${skill}" skipped — no search results`)
        results.push({ role: 'skills', status: 'skipped', detail: skill })
        continue
      }
      // Click the inner promptOption node (React listens for pointer events).
      const target =
        first.querySelector<HTMLElement>('[data-automation-id="promptOption"]') ??
        first.querySelector<HTMLElement>('[data-automation-id="promptLeafNode"]') ??
        first
      fireClick(target)
      await wait(300)
      log(`skill "${skill}" filled ✓ → selected "${optionLabel(first)}"`)
      results.push({ role: 'skills', status: 'filled', detail: skill })
      await wait(300)
    }

    return results
  },
}
