// ATS routing. detectAts() is the seam where each ATS plugs in: it maps the current
// frame's hostname to an ATS key, and detectorFor() maps that key to a detector. With
// allFrames injection, this runs per-frame — so a Greenhouse form embedded in a
// cross-origin iframe resolves to 'greenhouse' from inside that iframe. The dispatcher
// falls back to the Workday detector when the host isn't recognized, preserving the
// "fill on click anywhere" behavior (generic text/radio detection still works there).

import { WorkdayDetector } from './workday'
import { GreenhouseDetector } from './greenhouse'
import type { Detector } from '../types'

export function detectAts(): string | null {
  const h = location.hostname
  if (h.includes('myworkdayjobs.com')) return 'workday'
  if (h.includes('greenhouse.io')) return 'greenhouse'
  return null
}

export function detectorFor(ats: string | null): Detector | null {
  switch (ats) {
    case 'workday':
      return WorkdayDetector
    case 'greenhouse':
      return GreenhouseDetector
    default:
      return null
  }
}

export { WorkdayDetector, GreenhouseDetector }
