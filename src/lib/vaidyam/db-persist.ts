/**
 * Optional PostgreSQL persistence for Catena twins.
 *
 * Used by the Next.js API host when DATABASE_URL is available. Failures never
 * break the dashboard — every call is best-effort and returns null on error.
 */
import { desc, eq } from "drizzle-orm";
import type { Provenance } from "./types";

export async function pgConfigured(): Promise<boolean> {
  return Boolean(process.env.DATABASE_URL);
}

export async function ensureTwin(externalUid: string, prov: Provenance[]): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { db } = await import("@/db");
    const { twins } = await import("@/db/schema");
    const existing = await db
      .select({ id: twins.id })
      .from(twins)
      .where(eq(twins.externalUid, externalUid))
      .limit(1);
    if (!existing.length) {
      await db.insert(twins).values({
        externalUid,
        displayName: "Primary Twin",
      });
      prov.push({
        source: "PostgreSQL · twins",
        live: true,
        fetchedAt: new Date().toISOString(),
        detail: "created",
      });
    } else {
      prov.push({
        source: "PostgreSQL · twins",
        live: true,
        fetchedAt: new Date().toISOString(),
        detail: "hit",
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    prov.push({
      source: "PostgreSQL · twins",
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: message.slice(0, 80),
    });
  }
}

export async function loadRecentObservations(
  externalUid: string,
  limit = 30,
  prov: Provenance[],
): Promise<Record<string, unknown>[] | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { db } = await import("@/db");
    const { observations } = await import("@/db/schema");
    const rows = await db
      .select()
      .from(observations)
      .where(eq(observations.externalUid, externalUid))
      .orderBy(desc(observations.day))
      .limit(limit);
    prov.push({
      source: "PostgreSQL · observations",
      live: true,
      fetchedAt: new Date().toISOString(),
      detail: `${rows.length} rows`,
    });
    return rows as unknown as Record<string, unknown>[];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    prov.push({
      source: "PostgreSQL · observations",
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: message.slice(0, 80),
    });
    return null;
  }
}

export async function saveGraphSnapshot(
  externalUid: string,
  version: string,
  graph: Record<string, unknown>,
  prov: Provenance[],
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { db } = await import("@/db");
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
    prov.push({
      source: "PostgreSQL · graph_snapshots",
      live: true,
      fetchedAt: new Date().toISOString(),
      detail: `${nodes}n/${edges}e`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    prov.push({
      source: "PostgreSQL · graph_snapshots",
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: message.slice(0, 80),
    });
  }
}

export async function logApiEvent(route: string, externalUid: string | null, ok: boolean, ms: number) {
  if (!process.env.DATABASE_URL) return;
  try {
    const { db } = await import("@/db");
    const { apiEvents } = await import("@/db/schema");
    await db.insert(apiEvents).values({
      route,
      externalUid: externalUid || null,
      ok,
      ms,
    });
  } catch {
    /* non-fatal */
  }
}
