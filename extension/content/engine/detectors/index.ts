// ATS routing. Workday is the only detector for now; detectAts() is the seam where
// a second ATS plugs in. The dispatcher falls back to the Workday detector when the
// host isn't a recognized ATS, preserving the "fill on click anywhere" behavior
// (generic text/radio detection still works on other forms).

import { WorkdayDetector } from './workday'
import type { Detector } from '../types'

export function detectAts(): string | null {
  const h = location.hostname
  if (h.includes('myworkdayjobs.com')) return 'workday'
  return null
}

export function detectorFor(ats: string | null): Detector | null {
  switch (ats) {
    case 'workday':
      return WorkdayDetector
    default:
      return null
  }
}

export { WorkdayDetector }
