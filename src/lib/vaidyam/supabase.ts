/**
 * Supabase REST adapter (Postgres + pgvector persistence for the twin).
 *
 * Uses the PostgREST HTTP surface only — no SDK, no Node APIs, so it runs
 * unchanged on Cloudflare Workers. When SUPABASE_URL / keys are absent every
 * call resolves to null and the API layer serves its computed twin instead, so
 * the dashboard is fully functional before any database exists.
 */
import type { Bindings, Provenance } from './types'

/**
 * ENV-SAFETY NOTE
 * ---------------
 * `env` is NOT guaranteed to be an object. On Cloudflare Pages `c.env` is
 * populated, but the same Hono app is also mounted:
 *   • in the browser by src/local/engine.ts (local fallback engine), and
 *   • under `wrangler pages dev` before any binding exists,
 * where `c.env` is `undefined`. The previous code dereferenced `env.SUPABASE_URL`
 * directly, so `supabaseConfigured(undefined)` threw a TypeError — turning what
 * should have been a graceful "not configured, use the computed twin" path into
 * a hard 500 on /overview, /memory and /health. Every accessor below now
 * normalises `env` to `{}` first.
 */
export function supabaseConfigured(env?: Bindings | null) {
  const e = env || ({} as Bindings)
  return Boolean(e.SUPABASE_URL && (e.SUPABASE_SERVICE_KEY || e.SUPABASE_ANON_KEY))
}

function headers(env?: Bindings | null) {
  const e = env || ({} as Bindings)
  const key = e.SUPABASE_SERVICE_KEY || e.SUPABASE_ANON_KEY || ''
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    prefer: 'return=representation'
  }
}

export async function sbSelect<T>(
  env: Bindings | undefined | null,
  table: string,
  query: string,
  prov: Provenance[],
  timeoutMs = 6000
): Promise<T[] | null> {
  if (!supabaseConfigured(env)) return null
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${(env as Bindings).SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: headers(env),
      signal: ctrl.signal
    })
    clearTimeout(timer)
    if (!res.ok) {
      prov.push({ source: `Supabase · ${table}`, live: false, fetchedAt: new Date().toISOString(), detail: `HTTP ${res.status}` })
      return null
    }
    const rows = (await res.json()) as T[]
    prov.push({
      source: `Supabase · ${table}`,
      live: true,
      fetchedAt: new Date().toISOString(),
      detail: `${rows.length} rows · ${Date.now() - started}ms`
    })
    return rows
  } catch (err: any) {
    prov.push({
      source: `Supabase · ${table}`,
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: String(err?.message || err).slice(0, 80)
    })
    return null
  }
}

export async function sbUpsert<T>(
  env: Bindings | undefined | null,
  table: string,
  rows: unknown[],
  onConflict: string,
  prov: Provenance[]
): Promise<T[] | null> {
  if (!supabaseConfigured(env) || !rows.length) return null
  try {
    const res = await fetch(`${(env as Bindings).SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...headers(env), prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(rows)
    })
    if (!res.ok) {
      prov.push({ source: `Supabase upsert · ${table}`, live: false, fetchedAt: new Date().toISOString(), detail: `HTTP ${res.status}` })
      return null
    }
    prov.push({ source: `Supabase upsert · ${table}`, live: true, fetchedAt: new Date().toISOString(), detail: `${rows.length} rows` })
    return (await res.json()) as T[]
  } catch (err: any) {
    prov.push({
      source: `Supabase upsert · ${table}`,
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: String(err?.message || err).slice(0, 80)
    })
    return null
  }
}

/** Calls a Postgres function (used for the pgvector PPR / retrieval RPCs). */
export async function sbRpc<T>(
  env: Bindings | undefined | null,
  fn: string,
  args: Record<string, unknown>,
  prov: Provenance[]
): Promise<T | null> {
  if (!supabaseConfigured(env)) return null
  try {
    const res = await fetch(`${(env as Bindings).SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify(args)
    })
    if (!res.ok) {
      prov.push({ source: `Supabase rpc · ${fn}`, live: false, fetchedAt: new Date().toISOString(), detail: `HTTP ${res.status}` })
      return null
    }
    prov.push({ source: `Supabase rpc · ${fn}`, live: true, fetchedAt: new Date().toISOString() })
    return (await res.json()) as T
  } catch (err: any) {
    prov.push({
      source: `Supabase rpc · ${fn}`,
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: String(err?.message || err).slice(0, 80)
    })
    return null
  }
}
