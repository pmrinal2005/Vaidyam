/**
 * build-static.mjs
 * Produces `dist-static/` — a pure static bundle of the SynapseX site.
 *
 * Used by Vercel (free tier, zero serverless functions) and usable by any
 * static host. No dependencies beyond Node's stdlib, so `npm install` is not
 * even required for this step.
 */
import { cp, mkdir, rm, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'public')
const out = join(root, 'dist-static')

if (!existsSync(src)) {
  console.error('[build-static] missing source directory: public/')
  process.exit(1)
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(src, out, { recursive: true })

// Minimal SEO helpers generated at build time.
await writeFile(
  join(out, 'robots.txt'),
  'User-agent: *\nAllow: /\n',
  'utf8'
)

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

const files = await walk(out)
let total = 0
for (const file of files) total += (await stat(file)).size

console.log(`[build-static] wrote ${files.length} files (${(total / 1024).toFixed(1)} KB) to dist-static/`)
for (const file of files.sort()) console.log('  •', relative(out, file))
