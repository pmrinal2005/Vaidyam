/**
 * build-reveal.mjs
 * Compiles the React + motion/react "opening reveal" island with Vite and
 * syncs the emitted bundle into `public/static/reveal/`.
 *
 * The two-step (build to `.reveal-build/`, then copy) avoids Vite's publicDir
 * recursion guard, since `public/` is the static root of the host site.
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staging = join(root, '.reveal-build')
const target = join(root, 'public', 'static', 'reveal')

const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteBin)) {
  console.error('[build-reveal] vite is not installed — run `npm install` first.')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', 'vite.reveal.config.ts'],
  { cwd: root, stdio: 'inherit' }
)

if (result.status !== 0) {
  console.error('[build-reveal] vite build failed')
  process.exit(result.status ?? 1)
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(staging, target, { recursive: true })
await rm(staging, { recursive: true, force: true })

const files = await readdir(target)
let total = 0
for (const file of files) total += (await stat(join(target, file))).size

console.log(`[build-reveal] synced ${files.length} files (${(total / 1024).toFixed(1)} KB) to public/static/reveal/`)
for (const file of files.sort()) console.log('  •', file)
