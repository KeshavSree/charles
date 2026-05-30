const esbuild = require('esbuild')
const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  outdir: 'dist',
  logLevel: 'info',
}

const entryPoints = [
  { in: 'background/service-worker.ts', out: 'background/service-worker' },
  { in: 'content/index.ts',             out: 'content/index' },
  { in: 'popup/popup.ts',               out: 'popup/popup' },
]

if (watch) {
  esbuild.context({ ...shared, entryPoints }).then((ctx) => ctx.watch())
} else {
  esbuild.build({ ...shared, entryPoints })
}
