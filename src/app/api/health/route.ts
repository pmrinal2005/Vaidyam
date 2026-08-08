import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { providers } from "@/lib/vaidyam/inference";
import { supabaseConfigured } from "@/lib/vaidyam/supabase";
import type { Bindings } from "@/lib/vaidyam/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Unified /api/health
 * - Platform build_and_start expects { ok: true }
 * - Dashboard core.js probe requires { app: "catena" }
 */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbError: string | undefined;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err: unknown) {
    dbError = err instanceof Error ? err.message.slice(0, 120) : "db error";
  }

  const env = {
    USDA_API_KEY: process.env.USDA_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    NVIDIA_NIM_API_KEY: process.env.NVIDIA_NIM_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
  } as Bindings;

  const body = {
    ok: dbOk,
    app: "catena",
    service: "vaidyam",
    host: "nextjs",
    time: new Date().toISOString(),
    db: dbOk,
    postgres: dbOk,
    ms: Date.now() - started,
    layers: {
      ingestion: true,
      causalGraph: true,
      swarm: true,
      cascade: true,
      counterfactual: true,
      privacy: true,
    },
    providers: providers(env).map((p) => ({
      id: p.id,
      label: p.label,
      keyed: Boolean(p.key),
    })),
    supabase: supabaseConfigured(env),
    sources: [
      "Open-Meteo",
      "Open-Meteo Air Quality",
      "openFDA",
      "PubMed E-utilities",
      "Europe PMC",
      "USDA FoodData Central",
      "disease.sh",
    ],
    ...(dbError ? { error: dbError } : {}),
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 500 });
}
