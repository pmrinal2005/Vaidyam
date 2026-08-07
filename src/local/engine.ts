/**
 * Catena LOCAL ENGINE — the real edge API, executed inside the browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dashboard's panels all read `/api/*`, which is served by the Hono worker
 * in `src/api/index.ts`. That worker only exists in the Cloudflare Pages build
 * (`dist/_worker.js`). The project's configured deployment target, however, is
 * Vercel STATIC (`vercel.json` → `outputDirectory: "dist-static"`), an artifact
 * that contains only `index.html`, `dashboard.html`, `robots.txt` and
 * `static/**` — no serverless function, nothing that can answer
 * `/api/overview`. So every request 404'd and the dashboard rendered
 * "HTTP 404 on /overview" in place of every panel.
 *
 * This module removes that dependency on a server existing at all.
 *
 * HOW IT WORKS
 * ------------
 * Hono is runtime-agnostic: `app.fetch(Request)` is just a function from a
 * Request to a Response, with no Node/Workers API underneath. We import the
 * SAME `src/api/index.ts` the edge worker uses and call `app.fetch()` directly
 * in the page. Consequences that matter:
 *
 *   • ZERO logic duplication. Routing, envelopes, provenance, the causal graph,
 *     the swarm, the cascade, the DP aggregation and the zk attestations are the
 *     identical code paths — so response bodies are byte-identical to the edge
 *     worker's for the same inputs. There is no second implementation to drift.
 *   • It is viable ONLY because every upstream the API calls is CORS-open.
 *     Verified with live requests:
 *         api.open-meteo.com                → 200, ACAO *
 *         air-quality-api.open-meteo.com    → 200, ACAO *
 *         disease.sh                        → 200, ACAO *
 *         api.fda.gov                       → 200, ACAO *
 *         www.ebi.ac.uk (Europe PMC)        → 200, ACAO *
 *         eutils.ncbi.nlm.nih.gov (PubMed)  → 302, NO ACAO  → skipped in-browser
 *         api.nal.usda.gov + DEMO_KEY       → 429           → needs a real key
 *     PubMed is unreachable from a browser, which is exactly why the API already
 *     falls back to Europe PMC; `IS_BROWSER` in src/lib/sources.ts short-circuits
 *     straight to that mirror instead of logging a bogus failure.
 *
 * WHAT IS NECESSARILY DEGRADED HERE (and correctly labelled as such)
 * -----------------------------------------------------------------
 *   • `c.env` is empty — a browser has no secret store, and shipping keys to the
 *     client would leak them. So provider-backed LLM inference and Supabase
 *     persistence stay off and the cascade uses its deterministic graph
 *     reasoner. The provenance strip reports this; the live chip reads
 *     "local engine".
 *   • `request.cf` is absent, so geo falls back to the browser Geolocation API
 *     (already requested by core.js and forwarded as ?lat/?lon), then to the
 *     API's own default.
 *
 * To get fully live, keyed inference + persistence, deploy the Cloudflare Pages
 * build (which has `/api/*`) or point the dashboard at one with
 * `?api=<origin>/api`. See README → Environment variables.
 */
import api from '../api/index'

/** Vars the page may expose for the local engine. Never secrets. */
type PublicVars = Record<string, string>

function publicVars(): PublicVars {
  const out: PublicVars = {}
  try {
    const raw = (window as any).CATENA_PUBLIC_ENV
    if (raw && typeof raw === 'object') {
      // Only non-secret, explicitly public values are honoured. A browser can
      // never hold a real secret, so anything sensitive is deliberately ignored.
      for (const k of ['OPENAI_BASE_URL']) {
        if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k]
      }
    }
  } catch {
    /* no-op */
  }
  return out
}

/**
 * Executes a dashboard API request against the in-page Hono app.
 *
 * @param path  absolute path beginning with `/api` (as core.js builds it)
 * @param init  standard RequestInit (method / headers / body)
 */
async function localFetch(path: string, init?: RequestInit): Promise<Response> {
  // The app mounts its routes under /api (see src/index.tsx: app.route('/api')),
  // so we hand `api` the path with that prefix stripped.
  const rel = path.replace(/^\/api/, '') || '/'
  const url = new URL(rel, location.origin)
  const req = new Request(url.toString(), init)

  try {
    return await api.fetch(req, publicVars() as any)
  } catch (err: any) {
    // A thrown route is still a response as far as the dashboard is concerned:
    // returning 500 with the standard envelope shape lets C.errBox show the real
    // reason instead of an opaque unhandled rejection.
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(err?.message || err),
        engine: 'local',
        hint: 'The in-browser engine failed. A blocked upstream (CORS/offline) is the usual cause.'
      }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }
}

const engine = { fetch: localFetch, mode: 'local' as const }

// Published before the dashboard scripts run (this bundle is loaded first), so
// C.resolveApi() can see it as the last-resort transport.
;(window as any).Catena = (window as any).Catena || {}
;(window as any).Catena.localEngine = engine

export default engine
