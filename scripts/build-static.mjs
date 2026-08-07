/**
 * build-static.mjs
 * Produces `dist-static/` — a pure static bundle of the SynapseX site.
 *
 * Used by Vercel (alongside the /api Edge Function) and usable by any static
 * host. No dependencies beyond Node's stdlib.
 *
 * ── WHY THIS SCRIPT NOW FAILS LOUDLY ────────────────────────────────────────
 * This script used to only copy `public/` → `dist-static/` and always exit 0.
 * That is precisely how the reported "HTTP 404 on /overview" survived being
 * "fixed": the two-layer fallback (host-agnostic resolver + in-browser engine)
 * depends on `public/static/dash/local-engine.js` EXISTING in the artifact, but
 * that file is a gitignored build output. If `build:engine` had not run — a
 * fresh clone, a cache miss, a host whose build command skipped it — the copy
 * step happily produced a `dist-static/` with `dashboard.html` referencing a
 * script that was not there. The browser 404'd on the bundle, `C.localEngine`
 * stayed undefined, `resolveApi()` returned null, and every panel rendered
 * "Could not load live data." A green build shipped a broken dashboard.
 *
 * So the copy is now followed by a REQUIRED-ARTIFACT AUDIT that exits non-zero
 * on any missing/empty file or broken local reference. The build breaks in CI
 * instead of the dashboard breaking in production.
 */
import { cp, mkdir, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
await writeFile(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8')

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

/* ══════════════════════════════════════════════════════════════════════════
   REQUIRED-ARTIFACT AUDIT
   ══════════════════════════════════════════════════════════════════════════ */
const problems = []

/**
 * Files without which the deployed site is broken. The two generated bundles are
 * listed first because they are the ones that can legitimately be absent (they
 * are gitignored build outputs, not sources) — which is exactly why their
 * absence must be an error rather than a silent omission.
 */
const REQUIRED = [
  ['static/dash/local-engine.js', 'in-browser API fallback — run `npm run build:engine`'],
  ['static/reveal/reveal.js', 'reveal island bundle — run `npm run build:reveal`'],
  ['static/reveal/reveal.css', 'reveal island styles — run `npm run build:reveal`'],
  ['index.html', 'landing page'],
  ['dashboard.html', 'dashboard shell'],
  ['static/styles.css', 'landing styles'],
  ['static/dashboard.css', 'dashboard styles'],
  ['static/app.js', 'landing behaviour'],
  ['static/dash/core.js', 'dashboard API client'],
  ['static/dash/charts.js', 'chart renderers'],
  ['static/dash/views-core.js', 'overview / ingestion / saas views'],
  ['static/dash/views-reason.js', 'graph / swarm / cascade / counterfactual views'],
  ['static/dash/views-domain.js', 'environment / medication / nutrition / clinician views'],
  ['static/dash/views-privacy.js', 'privacy / public-health / memory views'],
  ['static/dash/app.js', 'dashboard router']
]

for (const [rel, why] of REQUIRED) {
  const full = join(out, rel)
  if (!existsSync(full)) {
    problems.push(`missing ${rel} — ${why}`)
    continue
  }
  const size = (await stat(full)).size
  if (size === 0) problems.push(`empty ${rel} — ${why}`)
}

/**
 * Every local `src`/`href` in the two HTML documents must resolve to a real file
 * in the artifact. This is the generic form of the check above: it catches a
 * reference added to HTML whose asset was never built, without needing the path
 * to be hard-coded in REQUIRED.
 */
for (const doc of ['index.html', 'dashboard.html']) {
  const full = join(out, doc)
  if (!existsSync(full)) continue
  const html = await readFile(full, 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1])
  for (const ref of [...new Set(refs)]) {
    // Clean URLs (e.g. /dashboard) are resolved by the host's rewrite rules, not
    // by a file on disk, so only extension-bearing asset paths are checked.
    if (!/\.[a-z0-9]{2,5}$/i.test(ref)) continue
    if (!existsSync(join(out, ref.replace(/^\//, '')))) {
      problems.push(`${doc} references ${ref} which is not in the artifact`)
    }
  }
}

// dashboard.html MUST load the engine before core.js — see DIAGNOSIS.md §3.
const dashPath = join(out, 'dashboard.html')
if (existsSync(dashPath)) {
  const html = await readFile(dashPath, 'utf8')
  const engineAt = html.indexOf('dash/local-engine.js')
  const coreAt = html.indexOf('dash/core.js')
  if (engineAt === -1) problems.push('dashboard.html does not load static/dash/local-engine.js')
  else if (coreAt !== -1 && engineAt > coreAt) {
    problems.push('dashboard.html loads local-engine.js AFTER core.js — the fallback must be published first')
  }
  // The stale-bundle bug in DIAGNOSIS.md §2 shipped a removed HLS player.
  if (/stream\.mux\.com|hls\.js/.test(html)) problems.push('dashboard.html contains a stale Mux/hls reference')
}

const indexPath = join(out, 'index.html')
if (existsSync(indexPath)) {
  const html = await readFile(indexPath, 'utf8')
  if (/stream\.mux\.com|hls\.js/.test(html)) problems.push('index.html contains a stale Mux/hls reference')
}

// A secret must never reach a static artifact — it would be world-readable.
const SECRET_RE = /(gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,})/
for (const file of files) {
  if (!/\.(js|css|html|json|txt)$/i.test(file)) continue
  const body = await readFile(file, 'utf8')
  if (SECRET_RE.test(body)) problems.push(`possible secret literal in ${relative(out, file)}`)
}

if (problems.length) {
  console.error(`\n[build-static] ✗ artifact is NOT deployable — ${problems.length} problem(s):`)
  for (const p of problems) console.error('  •', p)
  console.error(
    '\nRun the composite build instead of this script alone:\n  npm run build:static' +
      '\n(which is `npm run build:assets && node scripts/build-static.mjs`)\n'
  )
  process.exit(1)
}

console.log('[build-static] ✓ artifact audit passed — all required assets present and referenced correctly')
