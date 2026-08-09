import { NextResponse } from "next/server";
import { providers } from "@/lib/vaidyam/inference";
import { supabaseConfigured } from "@/lib/vaidyam/supabase";
import { pingDb } from "@/lib/vaidyam/db-persist";
import type { Bindings } from "@/lib/vaidyam/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Unified /api/health — the single most important route in the app.
 *
 * ── WHY THIS MUST ALWAYS RETURN 200 ───────────────────────────────────────
 * `public/static/dash/core.js` resolves its API base by probing
 * `<candidate>/health` and accepting the candidate ONLY when the response is
 * 2xx AND the JSON body contains `app === "catena"`. If this route answers
 * anything else, `C.resolveApi()` exhausts every candidate, `C.apiBase`
 * becomes null, and `C.api()` rejects for all 14 views — the dashboard-wide
 * "Could not load live data" error box.
 *
 * The previous version returned `status: dbOk ? 200 : 500`, i.e. it reported an
 * OPTIONAL dependency's absence as total API failure. Combined with the eager
 * `DATABASE_URL` throw in the old src/db/index.ts, an unconfigured database
 * took down every panel even though not one panel needs the database to render.
 *
 * Correct semantics: this endpoint reports the health of the API HOST. The API
 * host is up iff this code is executing. Postgres, Supabase and LLM providers
 * are reported as individual capability flags so the UI can label degradation,
 * and never as a transport failure.
 * ─────────────────────────────────────────────────────────────────────────── */
export async function GET() {
  const started = Date.now();

  // Best-effort: pingDb never throws and distinguishes "not configured" from
  // "configured but unreachable" — a distinction the UI surfaces verbatim.
  const database = await pingDb();

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

  let providerList: { id: string; label: string; keyed: boolean }[] = [];
  try {
    providerList = providers(env).map((p) => ({
      id: p.id,
      label: p.label,
      keyed: Boolean(p.key),
    }));
  } catch {
    providerList = [];
  }

  let supabase = false;
  try {
    supabase = supabaseConfigured(env);
  } catch {
    supabase = false;
  }

  const body = {
    // `ok` = the API host answered. Deliberately independent of optional deps.
    ok: true,
    app: "catena",
    service: "vaidyam",
    host: "nextjs",
    time: new Date().toISOString(),
    ms: Date.now() - started,
    layers: {
      ingestion: true,
      causalGraph: true,
      swarm: true,
      cascade: true,
      counterfactual: true,
      privacy: true,
    },
    providers: providerList,
    supabase,
    // Optional capabilities, reported without affecting `ok`.
    postgres: database.ok,
    db: {
      configured: database.configured,
      reachable: database.ok,
      // Postgres only persists twin history; no panel requires it.
      required: false,
      ...(database.error ? { error: database.error } : {}),
    },
    sources: [
      "Open-Meteo",
      "Open-Meteo Air Quality",
      "openFDA",
      "PubMed E-utilities",
      "Europe PMC",
      "USDA FoodData Central",
      "disease.sh",
    ],
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
