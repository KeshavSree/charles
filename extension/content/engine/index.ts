// Engine entry point. esbuild bundles this (with all strategies/detectors and the
// imported FIELDS registry) into dist/content/engine.js. The popup injects that file
// on Fill click, which runs this IIFE and attaches the engine to globalThis. A tiny
// follow-up executeScript func then calls globalThis.__charlesEngine.run(request).

import { run } from './dispatcher'
import type { FillRequest, FillSummary } from './types'

declare global {
  // eslint-disable-next-line no-var
  var __charlesEngine: { run: (req: FillRequest) => Promise<FillSummary> } | undefined
}

function sendProgress(msg: string) {
  chrome.runtime.sendMessage({ type: 'charles:progress', msg }).catch(() => {})
}

globalThis.__charlesEngine = { run: (req: FillRequest) => run(req, sendProgress) }
