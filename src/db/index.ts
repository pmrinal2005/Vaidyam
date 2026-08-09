/**
 * PostgreSQL access (Drizzle + node-postgres).
 *
 * ── WHY THIS FILE IS LAZY ─────────────────────────────────────────────────
 * The previous version did this at MODULE SCOPE:
 *
 *     const databaseUrl = process.env.DATABASE_URL;
 *     if (!databaseUrl) throw new Error("DATABASE_URL is required");
 *
 * That single throw is the actual mechanism behind the dashboard's "Could not
 * load live data" screenshot. The chain:
 *
 *   1. `src/app/api/health/route.ts` imported `{ db }` from here at the top
 *      level, so merely LOADING the /api/health module threw when
 *      DATABASE_URL was unset.
 *   2. Next.js turns a module-init throw into HTTP 500.
 *   3. `public/static/dash/core.js` probes `<base>/health` and requires a
 *      2xx + `{ app: "catena" }` envelope to accept a base. A 500 fails the
 *      probe, so EVERY candidate base was rejected and `C.apiBase` became
 *      null.
 *   4. `C.api()` then rejected with the "No Catena API reachable" message,
 *      and `C.load()`'s .catch replaced the whole view with `C.errBox` — for
 *      all 14 sections, which is exactly the reported symptom.
 *
 * The database is genuinely OPTIONAL for this app: every Catena route composes
 * live keyless upstreams plus deterministic reasoning, and `db-persist.ts` is
 * best-effort by design (it already returns null / pushes non-live provenance
 * on failure). So a missing DATABASE_URL must degrade, never throw.
 *
 * Therefore: the pool and the Drizzle instance are created on FIRST USE, and
 * `getDb()` returns null when no connection string is configured. Nothing here
 * runs at import time, so importing this module can never fail a route.
 * ─────────────────────────────────────────────────────────────────────────── */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/** Connection string, read lazily so build-time import never depends on it. */
export function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** True when a Postgres connection string is configured. */
export function isDbConfigured(): boolean {
  return Boolean(databaseUrl());
}

type DrizzleDb = NodePgDatabase<Record<string, never>>;

const globalForDb = globalThis as typeof globalThis & {
  __vaidyamPgPool?: Pool;
  __vaidyamDrizzle?: DrizzleDb;
};

/**
 * Returns the shared pool, or null when unconfigured.
 * Cached on globalThis so Next.js dev hot-reloads don't leak connections.
 */
export function getPool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (globalForDb.__vaidyamPgPool) return globalForDb.__vaidyamPgPool;

  const pool = new Pool({
    connectionString: url,
    // Supabase's pooler and most managed Postgres hosts terminate plaintext.
    // `sslmode` in the URI still wins; this is only the default.
    ssl: /sslmode=disable/.test(url) || /localhost|127\.0\.0\.1/.test(url)
      ? undefined
      : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 6000,
    idleTimeoutMillis: 30000,
  });

  // An idle-client error must not become an unhandled 'error' event that kills
  // the Node process — the app has to survive a dropped Postgres connection.
  pool.on("error", () => {
    /* swallowed deliberately; callers surface failures as non-live provenance */
  });

  globalForDb.__vaidyamPgPool = pool;
  return pool;
}

/** Returns the Drizzle instance, or null when Postgres is not configured. */
export function getDb(): DrizzleDb | null {
  if (globalForDb.__vaidyamDrizzle) return globalForDb.__vaidyamDrizzle;
  const pool = getPool();
  if (!pool) return null;
  const instance = drizzle(pool) as DrizzleDb;
  globalForDb.__vaidyamDrizzle = instance;
  return instance;
}
