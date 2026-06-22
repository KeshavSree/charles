// Generic "wait for async options to render" loop, shared by the custom-dropdown strategies
// (Greenhouse react-select menus, Workday remote-search multiselect). These widgets mount a
// placeholder/loading/empty node before their real options resolve, so each caller passes a
// collector (how to read the option nodes) and an `isReady` predicate (how to tell a real
// option from a placeholder). Returns the ready options, or [] once `maxMs` elapses.

import { wait } from '../dom'

export async function pollOptions<T>(
  collect: () => T[],
  isReady: (item: T) => boolean,
  { maxMs, stepMs = 250 }: { maxMs: number; stepMs?: number },
): Promise<T[]> {
  const start = Date.now()
  for (;;) {
    const ready = collect().filter(isReady)
    if (ready.length) return ready
    if (Date.now() - start >= maxMs) return []
    await wait(stepMs)
  }
}
