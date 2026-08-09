/**
 * Optional PostgreSQL persistence for Catena twins.
 *
 * CONTRACT: every function here is BEST-EFFORT and must never throw.
 * A missing DATABASE_URL, an unreachable host, or a not-yet-migrated schema all
 * degrade to `null` / non-live provenance so the dashboard keeps rendering.
 * This is why the whole app stays functional with no database at all.
 *
 * Uses the lazy `getDb()` accessor from `@/db` — importing that module has no
 * side effects and cannot throw, so a route can safely import this file
 * regardless of environment. (See the header of src/db/index.ts for how the
 * previous eager version produced the dashboard-wide 500 → probe failure.)
 */
import { desc, eq } from "drizzle-orm";
import type { Provenance } from "./types";

/** Adds a provenance row, tolerating a caller that passed no array. */
function note(prov: Provenance[] | undefined, source: string, live: boolean, detail: string) {
  if (!Array.isArray(prov)) return;
  prov.push({ source, live, fetchedAt: new Date().toISOString(), detail: detail.slice(0, 80) });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when a Postgres connection string is present. */
export async function pgConfigured(): Promise<boolean> {
  try {
    const { isDbConfigured } = await import("@/db");
    return isDbConfigured();
  } catch {
    return false;
  }
}

export async function ensureTwin(externalUid: string, prov: Provenance[]): Promise<void> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    if (!db) return;
    const { twins } = await import("@/db/schema");
    const existing = await db
      .select({ id: twins.id })
      .from(twins)
      .where(eq(twins.externalUid, externalUid))
      .limit(1);
    if (!existing.length) {
      await db.insert(twins).values({ externalUid, displayName: "Primary Twin" });
      note(prov, "PostgreSQL · twins", true, "created");
    } else {
      note(prov, "PostgreSQL · twins", true, "hit");
    }
  } catch (err: unknown) {
    note(prov, "PostgreSQL · twins", false, message(err));
  }
}

export async function loadRecentObservations(
  externalUid: string,
  limit = 30,
  prov: Provenance[],
): Promise<Record<string, unknown>[] | null> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    if (!db) return null;
    const { observations } = await import("@/db/schema");
    const rows = await db
      .select()
      .from(observations)
      .where(eq(observations.externalUid, externalUid))
      .orderBy(desc(observations.day))
      .limit(limit);
    note(prov, "PostgreSQL · observations", true, `${rows.length} rows`);
    return rows as unknown as Record<string, unknown>[];
  } catch (err: unknown) {
    note(prov, "PostgreSQL · observations", false, message(err));
    return null;
  }
}

export async function saveGraphSnapshot(
  externalUid: string,
  version: string,
  graph: Record<string, unknown>,
  prov: Provenance[],
): Promise<void> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    if (!db) return;
    const { graphSnapshots } = await import("@/db/schema");
    const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
    await db.insert(graphSnapshots).values({
      externalUid,
      version,
      nodeCount: nodes,
      edgeCount: edges,
      graph,
    });
    note(prov, "PostgreSQL · graph_snapshots", true, `${nodes}n/${edges}e`);
  } catch (err: unknown) {
    note(prov, "PostgreSQL · graph_snapshots", false, message(err));
  }
}

export async function logApiEvent(
  route: string,
  externalUid: string | null,
  ok: boolean,
  ms: number,
): Promise<void> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    if (!db) return;
    const { apiEvents } = await import("@/db/schema");
    await db.insert(apiEvents).values({ route, externalUid: externalUid || null, ok, ms });
  } catch {
    /* non-fatal */
  }
}

/** Round-trips `select 1`. Returns a structured result; never throws. */
export async function pingDb(): Promise<{ configured: boolean; ok: boolean; error?: string }> {
  try {
    const { getDb, isDbConfigured } = await import("@/db");
    if (!isDbConfigured()) return { configured: false, ok: false };
    const db = getDb();
    if (!db) return { configured: false, ok: false };
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`select 1`);
    return { configured: true, ok: true };
  } catch (err: unknown) {
    return { configured: true, ok: false, error: message(err).slice(0, 160) };
  }
}
