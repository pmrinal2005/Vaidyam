/**
 * verify.mjs — end-to-end verification harness.
 *
 * `package.json` mapped both `npm test` and `npm run verify` at this file, but
 * the file did not exist, so `npm test` failed with MODULE_NOT_FOUND and NOTHING
 * about the "HTTP 404 on /overview" fix was ever actually exercised. That is the
 * reason the two-layer fix (host-agnostic resolver + in-browser engine) could be
 * written, committed and still ship broken: no step proved the fallback ran.
 *
 * This harness closes that loop with four independent suites:
 *
 *   [1] EDGE WORKER      — every /api route against a live `wrangler pages dev`
 *                          (skipped automatically if nothing answers :3000).
 *   [2] LOCAL ENGINE     — loads the REAL compiled browser bundle
 *                          (public/static/dash/local-engine.js) inside a minimal
 *                          DOM shim and drives it exactly as core.js does. This
 *                          is the suite that proves the static-host 404 is gone:
 *                          if `window.Catena.localEngine` is missing or its
 *                          /overview response is not a 200 envelope, the
 *                          dashboard WILL show "HTTP 404 on /overview" and this
 *                          suite fails.
 *   [3] STATIC ARTIFACT  — asserts dist-static/ is internally consistent: the
 *                          engine bundle exists, dashboard.html loads it BEFORE
 *                          core.js, and no stale Mux/hls reference survived.
 *   [4] HYGIENE          — no build output or editor "- Copy" duplicate is
 *                          tracked in git (the mechanism behind the stale-bundle
 *                          bug in DIAGNOSIS.md §2).
 *
 * Usage
 *   npm run verify                  # all suites; edge suite auto-skips if down
 *   BASE=http://localhost:3000 npm run verify
 *   npm run verify -- --no-edge     # skip the network suite entirely
 */
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/+$/, '')
const SKIP_EDGE = process.argv.includes('--no-edge')

let pass = 0
let fail = 0
let skip = 0
const failures = []

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`
}

function ok(name, detail) {
  pass++
  console.log(`  ${C.g('✓')} ${name}${detail ? ' ' + C.d(detail) : ''}`)
}
function bad(name, reason) {
  fail++
  failures.push(`${name} — ${reason}`)
  console.log(`  ${C.r('✗')} ${name} ${C.r(String(reason))}`)
}
function skipped(name, reason) {
  skip++
  console.log(`  ${C.y('–')} ${name} ${C.d(reason)}`)
}
function head(n) {
  console.log('\n' + C.b(n))
}

/** Asserts the standard envelope shape produced by src/api/index.ts → envelope(). */
function checkEnvelope(name, status, body, { requireOk = true, minProv = 0 } = {}) {
  if (status !== 200) return bad(name, `HTTP ${status}`)
  if (!body || typeof body !== 'object') return bad(name, 'not a JSON object')
  if (requireOk && body.ok !== true) return bad(name, `ok=${body.ok} ${body.error || ''}`)
  if (minProv > 0) {
    const prov = Array.isArray(body.provenance) ? body.provenance : []
    if (prov.length < minProv) return bad(name, `provenance ${prov.length} < ${minProv}`)
  }
  const prov = Array.isArray(body.provenance) ? body.provenance : []
  const live = prov.filter((p) => p.live).length
  ok(name, prov.length ? `${live}/${prov.length} live${body.degraded ? ' · degraded' : ''}` : '')
}

/* Routes mirror src/api/index.ts exactly. `min` = provenance entries expected. */
const GET_ROUTES = [
  { path: '/health', envelope: false },
  { path: '/overview', min: 2 },
  { path: '/graph', min: 2 },
  { path: '/cascade', min: 2 },
  { path: '/counterfactual/levers', min: 2 },
  { path: '/environment', min: 2 },
  { path: '/medications', min: 2 },
  { path: '/nutrition', min: 2 },
  { path: '/zk/claims', min: 2 },
  { path: '/zk/verify?id=verify-harness', envelope: false },
  { path: '/public-health', min: 2 },
  { path: '/memory', min: 2 },
  { path: '/clinician-brief', min: 2 },
  { path: '/ingestion', min: 2 },
  { path: '/literature', min: 2 },
  { path: '/saas', min: 2 }
]

const POST_ROUTES = [
  { path: '/swarm', body: { query: 'why is my sleep affecting my blood pressure?' }, keys: ['agents', 'consensus'] },
  { path: '/zk/prove', body: { windowDays: 30 }, keys: ['attestation', 'shareToken'] },
  { path: '/counterfactual', body: { interventions: { sleepHours: 1 }, horizon: 60 }, keys: ['outcomes', 'levers'] }
]

const UID = 'verify-harness-uid'

/* ════════════════════════════════════════════════════════════════════════════
   [1] EDGE WORKER
   ════════════════════════════════════════════════════════════════════════════ */
async function suiteEdge() {
  head(`[1] Edge worker — ${BASE}/api/*`)

  if (SKIP_EDGE) return skipped('edge suite', '--no-edge')

  let up = false
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    up = r.ok && j.app === 'catena'
  } catch {
    up = false
  }
  if (!up) {
    return skipped(
      'edge suite',
      `no Catena worker at ${BASE} — start it with: npm run build && pm2 start ecosystem.config.cjs`
    )
  }

  // Documents must resolve as clean URLs (src/index.tsx asset() routes).
  for (const p of ['/', '/dashboard']) {
    try {
      const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(15000) })
      const html = await r.text()
      if (!r.ok) bad(`GET ${p}`, `HTTP ${r.status}`)
      else if (!/<html/i.test(html)) bad(`GET ${p}`, 'not HTML')
      else ok(`GET ${p}`, `${(html.length / 1024).toFixed(1)} KB`)
    } catch (e) {
      bad(`GET ${p}`, e.message)
    }
  }

  // A path under /api that does not exist MUST be JSON 404 — never the SPA
  // fallback. core.js's probe relies on this to reject a non-Catena origin fast.
  try {
    const r = await fetch(`${BASE}/api/__nope__`, { signal: AbortSignal.timeout(10000) })
    const ct = r.headers.get('content-type') || ''
    if (r.status !== 404) bad('GET /api/__nope__', `expected 404, got ${r.status}`)
    else if (!ct.includes('json')) bad('GET /api/__nope__', `expected JSON, got ${ct}`)
    else ok('GET /api/__nope__', '404 JSON (no HTML fallback)')
  } catch (e) {
    bad('GET /api/__nope__', e.message)
  }

  for (const route of GET_ROUTES) {
    const joiner = route.path.includes('?') ? '&' : '?'
    const url = `${BASE}/api${route.path}${joiner}uid=${UID}`
    const name = `GET /api${route.path}`
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'x-catena-user': UID },
        signal: AbortSignal.timeout(45000)
      })
      const body = await r.json()
      if (route.envelope === false) {
        if (r.status === 200 && body && body.ok === true) ok(name)
        else bad(name, `HTTP ${r.status} ok=${body && body.ok}`)
      } else {
        checkEnvelope(name, r.status, body, { minProv: route.min })
      }
    } catch (e) {
      bad(name, e.message)
    }
  }

  for (const route of POST_ROUTES) {
    const name = `POST /api${route.path}`
    try {
      const r = await fetch(`${BASE}/api${route.path}?uid=${UID}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-catena-user': UID },
        body: JSON.stringify(route.body),
        signal: AbortSignal.timeout(60000)
      })
      const body = await r.json()
      if (r.status !== 200 || body.ok !== true) {
        bad(name, `HTTP ${r.status} ok=${body && body.ok} ${(body && body.error) || ''}`)
        continue
      }
      const missing = route.keys.filter((k) => !(k in (body.data || {})))
      if (missing.length) bad(name, `data missing keys: ${missing.join(', ')}`)
      else ok(name, `data.{${route.keys.join(',')}}`)
    } catch (e) {
      bad(name, e.message)
    }
  }

  // Every dashboard script must be reachable, or panels die with a ReferenceError
  // that looks like an API failure.
  const scripts = [
    '/static/dash/local-engine.js',
    '/static/dash/core.js',
    '/static/dash/charts.js',
    '/static/dash/views-core.js',
    '/static/dash/views-reason.js',
    '/static/dash/views-domain.js',
    '/static/dash/views-privacy.js',
    '/static/dash/app.js',
    '/static/dashboard.css',
    '/static/styles.css',
    '/static/reveal/reveal.js',
    '/static/reveal/reveal.css'
  ]
  for (const s of scripts) {
    try {
      const r = await fetch(`${BASE}${s}`, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) bad(`asset ${s}`, `HTTP ${r.status}`)
      else ok(`asset ${s}`, `${((await r.text()).length / 1024).toFixed(1)} KB`)
    } catch (e) {
      bad(`asset ${s}`, e.message)
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   [2] LOCAL ENGINE  — the suite that actually proves the 404 fix
   ════════════════════════════════════════════════════════════════════════════ */
async function suiteLocalEngine() {
  head('[2] Local engine — the in-browser transport (static-host 404 fix)')

  const bundle = join(root, 'public', 'static', 'dash', 'local-engine.js')
  if (!existsSync(bundle)) {
    return bad(
      'local-engine.js exists',
      'missing — run `npm run build:engine`. Without it C.localEngine is undefined and every panel shows "HTTP 404 on /overview" on a static host.'
    )
  }
  ok('local-engine.js exists', `${((await stat(bundle)).size / 1024).toFixed(1)} KB`)

  const code = await readFile(bundle, 'utf8')

  /* Minimal DOM shim. The bundle references only window / document / location
     (verified by inspection), and `typeof document !== 'undefined'` is what
     src/lib/sources.ts uses as IS_BROWSER — so setting it here exercises the
     SAME browser code path the real page takes, including the Europe PMC
     substitution for CORS-blocked PubMed. */
  const origin = 'https://static-host.example'
  const win = {}
  const shim = {
    window: win,
    self: win,
    document: { querySelector: () => null, createElement: () => ({ style: {} }) },
    location: { origin, href: origin + '/dashboard', search: '', pathname: '/dashboard' },
    navigator: { userAgent: 'catena-verify' },
    fetch,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    console,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON
  }
  win.window = win
  Object.assign(win, shim)

  // The bundle is an IIFE that assigns onto `this` / `window`.
  try {
    const fn = new Function(...Object.keys(shim), `${code}\n;return window.Catena;`)
    win.Catena = undefined
    const Catena = fn.call(win, ...Object.keys(shim).map((k) => shim[k]))
    if (!Catena || !Catena.localEngine || typeof Catena.localEngine.fetch !== 'function') {
      return bad(
        'window.Catena.localEngine published',
        'bundle executed but did not expose a fetch() transport — core.js fallback would still be undefined'
      )
    }
    ok('window.Catena.localEngine published', `mode=${Catena.localEngine.mode}`)

    const engine = Catena.localEngine

    /* Drive it EXACTLY as core.js does: C.localEngine.fetch("/api" + path + "?" + qs) */
    async function call(path, init) {
      const res = await engine.fetch(`/api${path}${path.includes('?') ? '&' : '?'}uid=${UID}`, init)
      let body = null
      try {
        body = JSON.parse(await res.text())
      } catch {
        /* leave null */
      }
      return { status: res.status, body }
    }

    // /health first — this is what resolveApi() probes.
    const h = await call('/health')
    if (h.status !== 200 || !h.body || h.body.app !== 'catena') {
      bad('local /health', `HTTP ${h.status} app=${h.body && h.body.app}`)
    } else {
      ok('local /health', `app=catena · supabase=${h.body.supabase}`)
    }

    // THE regression assertion. This exact request is what rendered
    // "Could not load live data. HTTP 404 on /overview".
    const ov = await call('/overview')
    if (ov.status === 404) {
      bad('local /overview', 'HTTP 404 — the reported bug is NOT fixed')
    } else {
      checkEnvelope('local /overview', ov.status, ov.body, { minProv: 2 })
    }

    for (const route of GET_ROUTES) {
      if (route.path === '/health' || route.path === '/overview') continue
      const name = `local ${route.path}`
      try {
        const r = await call(route.path)
        if (route.envelope === false) {
          if (r.status === 200 && r.body && r.body.ok === true) ok(name)
          else bad(name, `HTTP ${r.status} ok=${r.body && r.body.ok}`)
        } else {
          checkEnvelope(name, r.status, r.body, { minProv: route.min })
        }
      } catch (e) {
        bad(name, e.message)
      }
    }

    for (const route of POST_ROUTES) {
      const name = `local POST ${route.path}`
      try {
        const r = await call(route.path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(route.body)
        })
        if (r.status !== 200 || !r.body || r.body.ok !== true) {
          bad(name, `HTTP ${r.status} ok=${r.body && r.body.ok}`)
          continue
        }
        const missing = route.keys.filter((k) => !(k in (r.body.data || {})))
        if (missing.length) bad(name, `data missing: ${missing.join(', ')}`)
        else ok(name, `data.{${route.keys.join(',')}}`)
      } catch (e) {
        bad(name, e.message)
      }
    }

    // A browser has no secret store, so the engine must never receive one.
    // Anything else here would mean keys were shipped to the client.
    if (/GROQ_API_KEY\s*[:=]\s*["'][^"']+["']/.test(code) || /sk-[a-zA-Z0-9]{20,}/.test(code)) {
      bad('no secrets baked into engine bundle', 'a key-shaped literal is present in the shipped JS')
    } else {
      ok('no secrets baked into engine bundle')
    }
  } catch (e) {
    bad('local engine executes', e.message)
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   [3] STATIC ARTIFACT
   ════════════════════════════════════════════════════════════════════════════ */
async function suiteStatic() {
  head('[3] Static artifact — dist-static/ consistency')

  const out = join(root, 'dist-static')
  if (!existsSync(out)) {
    return skipped('static suite', 'dist-static/ absent — run `npm run build:static`')
  }

  const required = [
    'index.html',
    'dashboard.html',
    'robots.txt',
    'static/styles.css',
    'static/dashboard.css',
    'static/app.js',
    'static/dash/core.js',
    'static/dash/local-engine.js',
    'static/reveal/reveal.js',
    'static/reveal/reveal.css'
  ]
  for (const rel of required) {
    const p = join(out, rel)
    if (!existsSync(p)) bad(`dist-static/${rel}`, 'missing')
    else ok(`dist-static/${rel}`, `${((await stat(p)).size / 1024).toFixed(1)} KB`)
  }

  // Script ORDER matters: local-engine.js must execute before core.js or
  // C.localEngine is undefined at resolveApi() time.
  const dashPath = join(out, 'dashboard.html')
  if (existsSync(dashPath)) {
    const html = await readFile(dashPath, 'utf8')
    const iEngine = html.indexOf('local-engine.js')
    const iCore = html.indexOf('dash/core.js')
    if (iEngine === -1) bad('dashboard.html loads local-engine.js', 'reference not found')
    else if (iCore === -1) bad('dashboard.html loads core.js', 'reference not found')
    else if (iEngine > iCore) bad('local-engine.js precedes core.js', 'wrong document order')
    else ok('local-engine.js precedes core.js')
  }

  // Stale-bundle guard (DIAGNOSIS.md §2): no removed Mux/hls reference anywhere.
  const stale = []
  for (const rel of ['index.html', 'dashboard.html', 'static/reveal/reveal.js', 'static/app.js']) {
    const p = join(out, rel)
    if (!existsSync(p)) continue
    const txt = await readFile(p, 'utf8')
    if (/stream\.mux\.com/.test(txt)) stale.push(`${rel}: stream.mux.com`)
    if (/hls\.js|hls\.min\.js/.test(txt)) stale.push(`${rel}: hls.js`)
  }
  if (stale.length) bad('no stale Mux/hls reference in dist-static', stale.join('; '))
  else ok('no stale Mux/hls reference in dist-static')
}

/* ════════════════════════════════════════════════════════════════════════════
   [4] HYGIENE
   ════════════════════════════════════════════════════════════════════════════ */
async function suiteHygiene() {
  head('[4] Repo hygiene — nothing generated may be tracked')

  let tracked
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return skipped('hygiene suite', 'not a git repository')
  }

  const rules = [
    { label: 'dist/ not tracked', re: /^dist\// },
    { label: 'dist-static/ not tracked', re: /^dist-static\// },
    { label: 'reveal bundle not tracked', re: /^public\/static\/reveal\// },
    { label: 'local-engine bundle not tracked', re: /^public\/static\/dash\/local-engine\.js$/ },
    { label: 'no "- Copy" duplicates tracked', re: / - Copy\./ },
    { label: 'gitignore.txt not tracked', re: /^gitignore\.txt$/ },
    { label: 'no real secret files tracked', re: /^(\.env|\.dev\.vars)$/ }
  ]
  for (const rule of rules) {
    const hits = tracked.filter((f) => rule.re.test(f))
    if (hits.length) bad(rule.label, `${hits.length} tracked: ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? '…' : ''}`)
    else ok(rule.label)
  }

  // The *.example templates must stay tracked — they are the key documentation.
  for (const f of ['.env.example', '.dev.vars.example']) {
    if (tracked.includes(f)) ok(`${f} tracked`)
    else bad(`${f} tracked`, 'missing — env documentation would be lost')
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(C.b('\nCATENA VERIFY'))
console.log(C.d(`root ${root}`))
console.log(C.d(`base ${BASE}${SKIP_EDGE ? ' (edge suite skipped)' : ''}`))

await suiteEdge()
await suiteLocalEngine()
await suiteStatic()
await suiteHygiene()

console.log(
  '\n' +
    C.b('RESULT  ') +
    C.g(`${pass} passed`) +
    (fail ? '  ' + C.r(`${fail} failed`) : '') +
    (skip ? '  ' + C.y(`${skip} skipped`) : '')
)
if (fail) {
  console.log('\n' + C.r('Failures:'))
  for (const f of failures) console.log('  • ' + f)
  process.exit(1)
}
console.log(C.g('All checks passed.\n'))
