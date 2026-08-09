import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function isDbConfigured(): boolean {
  return Boolean(databaseUrl());
}

type DrizzleDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __vaidyamPgPool?: Pool;
  __vaidyamDrizzle?: DrizzleDb;
};

export function getPool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (globalForDb.__vaidyamPgPool) return globalForDb.__vaidyamPgPool;

  const pool = new Pool({
    connectionString: url,
    ssl:
      /sslmode=disable/.test(url) || /localhost|127\.0\.0\.1/.test(url)
        ? undefined
        : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 6000,
    idleTimeoutMillis: 30000,
  });

  pool.on("error", () => {});

  globalForDb.__vaidyamPgPool = pool;
  return pool;
}

export function getDb(): DrizzleDb | null {
  if (globalForDb.__vaidyamDrizzle) return globalForDb.__vaidyamDrizzle;
  const pool = getPool();
  if (!pool) return null;
  const instance = drizzle(pool, { schema });
  globalForDb.__vaidyamDrizzle = instance;
  return instance;
}

/** @deprecated Prefer getDb() — kept for any legacy imports. */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const instance = getDb();
    if (!instance) {
      throw new Error("DATABASE_URL is not configured");
    }
    return Reflect.get(instance, prop, receiver);
  },
});
