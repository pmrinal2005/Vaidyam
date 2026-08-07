/**
 * build-local-engine.mjs
 * Compiles `src/local/engine.ts` (the in-browser Hono API) with Vite and syncs
 * the emitted bundle into `public/static/dash/local-engine.js`.
 *
 * Mirrors scripts/build-reveal.mjs: build into a staging dir outside `public/`
 * (Vite's publicDir guard), then copy the single artifact in. From there both
 * the static pipeline (scripts/build-static.mjs) and the Cloudflare Pages build
 * pick it up with no further wiring.
 *
 * The emitted file is a BUILD OUTPUT and is gitignored, for exactly the reason
 * documented in DIAGNOSIS.md §2: a committed bundle silently outlived the source
 * edit that was supposed to change it.
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, rm, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staging = join(root, '.local-engine-build')
const targetDir = join(root, 'public', 'static', 'dash')
const artifact = 'local-engine.js'

const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteBin)) {
  console.error('[build-local-engine] vite is not installed — run `npm install` first.')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', 'vite.local-engine.config.ts'],
  { cwd: root, stdio: 'inherit' }
)

if (result.status !== 0) {
  console.error('[build-local-engine] vite build failed')
  process.exit(result.status ?? 1)
}

const emitted = join(staging, artifact)
if (!existsSync(emitted)) {
  const found = existsSync(staging) ? (await readdir(staging)).join(', ') : '(no staging dir)'
  console.error(`[build-local-engine] expected ${artifact} in .local-engine-build/, found: ${found}`)
  process.exit(1)
}

await mkdir(targetDir, { recursive: true })
await rm(join(targetDir, artifact), { force: true })
await cp(emitted, join(targetDir, artifact))
await rm(staging, { recursive: true, force: true })

const size = (await stat(join(targetDir, artifact))).size
console.log(
  `[build-local-engine] synced ${artifact} (${(size / 1024).toFixed(1)} KB) to public/static/dash/`
)
