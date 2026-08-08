/**
 * Catena / Vaidyam — local PostgreSQL schema via Drizzle.
 *
 * Mirrors the essential Supabase tables from the original project so the twin
 * can persist observations, graph snapshots, swarm runs and privacy artefacts
 * without requiring an external Supabase project. All columns are optional
 * enough that the live API still works fully when tables are empty.
 */
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** Browser-local twin registry (external_uid is the client catena-uid). */
export const twins = pgTable(
  "twins",
  {
    id: serial("id").primaryKey(),
    externalUid: varchar("external_uid", { length: 64 }).notNull(),
    displayName: text("display_name"),
    graphVersion: text("graph_version").notNull().default("v0.0.1"),
    homeLat: doublePrecision("home_lat"),
    homeLon: doublePrecision("home_lon"),
    city: text("city"),
    country: text("country"),
    consentDp: boolean("consent_dp").notNull().default(false),
    consentPharma: boolean("consent_pharma").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("twins_external_uid_idx").on(t.externalUid)],
);

/** Daily observation rows used to re-estimate causal edges. */
export const observations = pgTable(
  "observations",
  {
    id: serial("id").primaryKey(),
    externalUid: varchar("external_uid", { length: 64 }).notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    sleepHours: numeric("sleep_hours", { precision: 4, scale: 2 }),
    sleepEfficiency: numeric("sleep_efficiency", { precision: 5, scale: 2 }),
    deepSleepPct: numeric("deep_sleep_pct", { precision: 5, scale: 2 }),
    remPct: numeric("rem_pct", { precision: 5, scale: 2 }),
    restingHr: numeric("resting_hr", { precision: 5, scale: 1 }),
    hrv: numeric("hrv", { precision: 5, scale: 1 }),
    spo2: numeric("spo2", { precision: 5, scale: 2 }),
    steps: integer("steps"),
    systolic: numeric("systolic", { precision: 5, scale: 1 }),
    diastolic: numeric("diastolic", { precision: 5, scale: 1 }),
    mood: numeric("mood", { precision: 4, scale: 2 }),
    stress: numeric("stress", { precision: 5, scale: 2 }),
    glucose: numeric("glucose", { precision: 5, scale: 1 }),
    sodiumMg: integer("sodium_mg"),
    hydrationMl: integer("hydration_ml"),
    adherence: numeric("adherence", { precision: 5, scale: 2 }),
    symptomLoad: numeric("symptom_load", { precision: 4, scale: 2 }),
    pm25: numeric("pm25", { precision: 6, scale: 2 }),
    aqi: integer("aqi"),
    screenMin: integer("screen_min"),
    respiratoryRate: numeric("respiratory_rate", { precision: 4, scale: 1 }),
    source: text("source").notNull().default("computed"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("observations_uid_day_idx").on(t.externalUid, t.day)],
);

/** Snapshot of the personal causal graph for a twin. */
export const graphSnapshots = pgTable("graph_snapshots", {
  id: serial("id").primaryKey(),
  externalUid: varchar("external_uid", { length: 64 }).notNull(),
  version: text("version").notNull().default("v0.0.1"),
  nodeCount: integer("node_count").notNull().default(0),
  edgeCount: integer("edge_count").notNull().default(0),
  graph: jsonb("graph").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Agent-swarm run telemetry. */
export const swarmRuns = pgTable("swarm_runs", {
  id: serial("id").primaryKey(),
  externalUid: varchar("external_uid", { length: 64 }).notNull(),
  query: text("query").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Zero-knowledge / DP privacy artefacts. */
export const attestations = pgTable("attestations", {
  id: serial("id").primaryKey(),
  externalUid: varchar("external_uid", { length: 64 }).notNull(),
  claimId: text("claim_id").notNull(),
  publicOutput: jsonb("public_output").$type<Record<string, unknown>>().notNull(),
  proofHash: text("proof_hash"),
  windowDays: integer("window_days").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Counterfactual simulation history. */
export const simulations = pgTable("simulations", {
  id: serial("id").primaryKey(),
  externalUid: varchar("external_uid", { length: 64 }).notNull(),
  levers: jsonb("levers").$type<Record<string, unknown>>().notNull(),
  horizonDays: integer("horizon_days").notNull().default(60),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Lightweight API request audit (health / overview probes). */
export const apiEvents = pgTable("api_events", {
  id: serial("id").primaryKey(),
  route: text("route").notNull(),
  externalUid: varchar("external_uid", { length: 64 }),
  ok: boolean("ok").notNull().default(true),
  ms: integer("ms").notNull().default(0),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
