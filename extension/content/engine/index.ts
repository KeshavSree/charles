// Engine entry point. esbuild bundles this (with the registry, widgets, and the field
// catalog) into dist/content/engine.js. The popup injects that file
// on Fill click, which runs this IIFE and attaches the engine to globalThis. A tiny
// follow-up executeScript func then calls globalThis.__charlesEngine.run(request).

import { run } from './runtime'
import type { FillRequest, FillSummary } from './types'

declare global {
  // eslint-disable-next-line no-var
  var __charlesEngine: {
    run: (req: FillRequest) => Promise<FillSummary>
    runAutomatic: (req: FillRequest) => Promise<FillSummary>
  } | undefined
}

function sendProgress(msg: string) {
  chrome.runtime.sendMessage({ type: 'charles:progress', msg }).catch(() => {})
}

// Automatic callers may observe every ATS mutation. Keep the first attempt even
// after it settles (or fails), so later notifications cannot overwrite user edits.
// Reuse the closure on reinjection: the popup injects this bundle on every click.
const runAutomatic = globalThis.__charlesEngine?.runAutomatic ?? (() => {
  let firstPass: Promise<FillSummary> | undefined
  return (req: FillRequest): Promise<FillSummary> => {
    // Cache before invoking the runtime, including synchronous/reentrant calls.
    return firstPass ??= Promise.resolve().then(() => run(req, sendProgress))
  }
})()

globalThis.__charlesEngine = {
  run: (req: FillRequest) => run(req, sendProgress),
  runAutomatic,
}
