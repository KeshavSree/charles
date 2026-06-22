// Coverage matrix: prints, per ATS, which widget carries each field — the visible map of
// what's supported and where the gaps are. Run: `npm run coverage`.
//   - "pseudo" rows are engine roles with no catalog field (full_name, sections, resume…).
//   - "Per-ATS gaps" lists catalog fields absent from an ATS (informational).
//   - Exits non-zero if a catalog field is fillable in NO ATS (a real orphan).

import { REGISTRY } from '../content/engine/registry'
import { FIELDS } from '../../frontend/lib/fields'
import type { Ats } from '../content/engine/types'

declare const process: { exit(code: number): never }

const roleOf = (f: { key: string; fillKey?: string }) => f.fillKey ?? f.key
const atses = Object.keys(REGISTRY) as Ats[]

// role → ats → widget names carrying it
const coverage = new Map<string, Record<string, string[]>>()
for (const ats of atses) {
  for (const [widgetName, leaf] of Object.entries(REGISTRY[ats])) {
    for (const field of Object.keys(leaf.fields)) {
      const m = coverage.get(field) ?? {}
      ;(m[ats] ??= []).push(widgetName)
      coverage.set(field, m)
    }
  }
}

const catalogRoles = FIELDS.map(roleOf)
const allRoles = Array.from(new Set([...catalogRoles, ...coverage.keys()]))
const pad = (s: string, n: number) => s.padEnd(n)

console.log(pad('FIELD', 24) + atses.map((a) => pad(a, 30)).join(''))
console.log('-'.repeat(24 + atses.length * 30))
for (const r of allRoles) {
  const m = coverage.get(r) ?? {}
  const cells = atses.map((a) => pad(m[a]?.join(', ') ?? '—', 30))
  console.log(pad(r, 24) + cells.join('') + (catalogRoles.includes(r) ? '' : '(pseudo)'))
}

const gaps: string[] = []
for (const r of catalogRoles) {
  const m = coverage.get(r) ?? {}
  for (const a of atses) if (!m[a]) gaps.push(`${r} → no ${a}`)
}
console.log('\nPer-ATS gaps (catalog field with no leaf in that ATS):')
for (const g of gaps) console.log('  - ' + g)

const orphans = catalogRoles.filter((r) => !coverage.has(r))
if (orphans.length) {
  console.error('\nORPHAN catalog fields (fillable in NO ATS): ' + orphans.join(', '))
  process.exit(1)
}
console.log('\nOK: every catalog field is covered by at least one ATS.')
