/**
 * Vercel Edge Function — mounts the SAME Catena Hono API at /api/*.
 *
 * WHY THIS FILE IS THE REAL FIX FOR "HTTP 404 on /overview"
 * ─────────────────────────────────────────────────────────
 * DIAGNOSIS.md §3 correctly identified the mechanism (the deployed artifact had
 * no `/api` worker) and shipped two mitigations: a host-agnostic base resolver
 * in `core.js`, and the in-browser local engine. Both work. But neither can make
 * the dashboard *fully* live on the configured host, because of a hard
 * constraint neither one can escape:
 *
 *     A BROWSER CANNOT HOLD A SECRET.
 *
 * So on the previous setup, `USDA_API_KEY`, `GROQ_API_KEY`, `SUPABASE_*` etc.
 * were documented, gitignored, validated — and then read by *nobody*, because
 * `outputDirectory: "dist-static"` contains no executable code at all. Setting
 * a key in the Vercel dashboard changed literally nothing. Every keyed panel was
 * permanently stuck on its deterministic fallback, and the only honest answer to
 * "what do I put in .env to make the dashboard live?" was "nothing works here".
 *
 * This function closes that gap. Vercel detects `api/**` and deploys it as a
 * function *alongside* the static output, so:
 *
 *   • `/api/*` is answered by the real `src/api/index.ts` — the identical app the
 *     Cloudflare worker and the local engine run, so envelopes stay byte-identical
 *     and there is still exactly ONE implementation.
 *   • `process.env` is injected server-side, so every key in `.env.example`
 *     finally takes effect on this host, and NONE of them reach the browser.
 *   • `core.js`'s same-origin `/api` candidate now *succeeds* on its first probe,
 *     which means the in-browser engine correctly demotes itself to what it was
 *     always meant to be: a last-resort fallback for a genuinely serverless host
 *     (GitHub Pages, S3, `npm run serve:static`), not the primary transport.
 *
 * The runtime is `edge`, matching Cloudflare Workers semantics (Web `Request`/
 * `Response`, `fetch`, Web Crypto), so `src/api/**` and `src/lib/**` run here
 * unmodified — no Node built-ins, no second code path to keep in sync.
 */
import { handle } from 'hono/vercel'
import { Hono } from 'hono'
import api from '../src/api/index'
import type { Bindings } from '../src/lib/types'

export const config = { runtime: 'edge' }

/**
 * On Cloudflare, secrets arrive as `c.env`. On Vercel they live in `process.env`,
 * and Hono's Vercel adapter passes no env object at all — `c.env` would be
 * `undefined`, which is exactly the shape that used to make `supabaseConfigured`
 * throw (DIAGNOSIS.md §3, "secondary contributing factors").
 *
 * This middleware normalises the two runtimes: it copies only the keys the app
 * actually declares in `Bindings` out of `process.env` and into `c.env`, so
 * `src/api/**` keeps reading `c.env.GROQ_API_KEY` with no host-specific
 * branching anywhere in the app.
 *
 * Allow-listed deliberately — an unfiltered `process.env` spread would hand the
 * request context every unrelated platform variable (`AWS_*`, `VERCEL_*`,
 * tokens from other integrations), widening the blast radius of any future log
 * or error-echo bug.
 */
const ENV_KEYS = [
  'USDA_API_KEY',
  'GROQ_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY'
] as const

function envFromProcess(): Bindings {
  const out: Record<string, string> = {}
  try {
    const src: Record<string, string | undefined> =
      typeof process !== 'undefined' && process.env ? (process.env as any) : {}
    for (const k of ENV_KEYS) {
      const v = src[k]
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
  } catch {
    /* no process in this runtime — an empty env degrades gracefully by design */
  }
  return out as Bindings
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

app.use('*', async (c, next) => {
  // `c.env` is readonly in the type, but assigning it is how the adapter-less
  // runtimes are bridged; the app only ever reads it.
  ;(c as any).env = { ...envFromProcess(), ...((c as any).env || {}) }
  await next()
})

app.route('/', api)

export default handle(app)
export const GET = handle(app)
export const POST = handle(app)
export const OPTIONS = handle(app)
