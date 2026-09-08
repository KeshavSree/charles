const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const path = require('node:path')
const esbuild = require('esbuild')

// Exercise the real entrypoint, including bundle reinjection. Stub only the
// runtime: its DOM widget behavior is independent of the invocation guard.
const bundle = esbuild.build({
  entryPoints: [path.join(__dirname, '../content/engine/index.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  plugins: [{
    name: 'stub-fill-runtime',
    setup(build) {
      build.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: 'runtime', namespace: 'test' }))
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const run = (...args) => globalThis.fillRuntime(...args)',
      }))
    },
  }],
}).then(result => result.outputFiles[0].text)

async function documentContext(fillRuntime) {
  const context = vm.createContext({ fillRuntime })
  vm.runInContext(await bundle, context)
  return context
}

for (const ats of ['greenhouse', 'workday']) {
  test(`${ats}: overlapping triggers and later mutations preserve manual edits`, async () => {
    let fills = 0
    let value = ''
    let complete
    const context = await documentContext(async req => {
      fills++
      value = req.value
      await new Promise(resolve => { complete = resolve })
      return { filled: 1 }
    })
    const engine = context.__charlesEngine
    const first = engine.runAutomatic({ ats, value: 'automatic' })
    const overlap = engine.runAutomatic({ ats, value: 'second request' })
    assert.strictEqual(overlap, first)
    await Promise.resolve()
    assert.equal(fills, 1)
    complete()
    const summary = await first
    value = 'manual correction'
    assert.strictEqual(await engine.runAutomatic({ ats, value: 'overwrite' }), summary)
    assert.equal(fills, 1)
    assert.equal(value, 'manual correction')
  })
}

test('reinjection retains automatic guard while explicit fills remain repeatable', async () => {
  let fills = 0
  const context = await documentContext(async () => ({ filled: ++fills }))
  const first = context.__charlesEngine.runAutomatic({})
  // Reinject while the first pass is still pending, as another caller might do.
  vm.runInContext(await bundle, context)
  assert.strictEqual(context.__charlesEngine.runAutomatic({}), first)
  await first
  vm.runInContext(await bundle, context)
  assert.strictEqual(context.__charlesEngine.runAutomatic({}), first)
  await context.__charlesEngine.run({})
  await context.__charlesEngine.run({})
  assert.equal(fills, 3)
  assert.strictEqual(context.__charlesEngine.runAutomatic({}), first)
})

for (const synchronous of [true, false]) {
  test(`${synchronous ? 'synchronous' : 'async'} failure does not create an automatic retry loop`, async () => {
    let fills = 0
    const error = new Error('fill failed')
    const context = await documentContext(() => {
      fills++
      if (synchronous) throw error
      return Promise.reject(error)
    })
    const first = context.__charlesEngine.runAutomatic({})
    await assert.rejects(first, err => err === error)
    vm.runInContext(await bundle, context)
    assert.strictEqual(context.__charlesEngine.runAutomatic({}), first)
    await assert.rejects(context.__charlesEngine.runAutomatic({}), err => err === error)
    assert.equal(fills, 1)
  })
}

test('a fresh document has its own automatic pass', async () => {
  let fills = 0
  const runtime = async () => ({ filled: ++fills })
  const first = await documentContext(runtime)
  const second = await documentContext(runtime)
  await first.__charlesEngine.runAutomatic({})
  await second.__charlesEngine.runAutomatic({})
  assert.equal(fills, 2)
})
