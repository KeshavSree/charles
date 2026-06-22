// Shared open-and-read mechanics for Workday's custom dropdowns (the selectWidget). Both
// the fixed-id combobox (country/state) and the question-text combobox open the same way
// and read options from the same DOM, which varies by Workday form version — hence the
// specificity-ordered fallback. The skills multiselect is different (remote search) and is
// NOT covered here.

import { wait } from '../dom'

/** The element that opens the dropdown: prefer Workday's selectWidget, else a plain button. */
export function findDropdownTrigger(container: HTMLElement): HTMLElement | null {
  return (
    container.querySelector<HTMLElement>('[data-automation-id="selectWidget"]') ??
    container.querySelector<HTMLElement>('button')
  )
}

/** Read the currently-rendered dropdown options, trying selectors in specificity order. */
export function collectWorkdayOptions(): HTMLElement[] {
  let options = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'))
  if (options.length === 0) options = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'))
  if (options.length === 0) options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter((el) => !el.getAttribute('data-automation-id'))
  return options
}

/**
 * Click the dropdown's trigger and return its rendered options (after `waitMs` for them to
 * mount). Returns null when there's no trigger at all; an empty array when the menu opened
 * but rendered nothing yet — callers distinguish the two.
 */
export async function openDropdown(container: HTMLElement, waitMs = 400): Promise<HTMLElement[] | null> {
  const trigger = findDropdownTrigger(container)
  if (!trigger) return null
  trigger.click()
  await wait(waitMs)
  return collectWorkdayOptions()
}

/** Dismiss an open dropdown (Escape) — used after a failed match so the menu doesn't linger. */
export function dismissDropdown(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}
