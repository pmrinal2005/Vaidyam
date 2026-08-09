import { NextResponse } from "next/server";
import type { Bindings } from "@/lib/vaidyam/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FALLBACK_BODY = {
  ok: true,
  app: "catena",
  service: "vaidyam",
  host: "nextjs",
  time: new Date(0).toISOString(),
  ms: 0,
  layers: {
    ingestion: true,
    causalGraph: true,
    swarm: true,
    cascade: true,
    counterfactual: true,
    privacy: true,
  },
  providers: [] as { id: string; label: string; keyed: boolean }[],
  supabase: false,
  postgres: false,
  db: { configured: false, reachable: false, required: false },
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

export async function GET() {
  const started = Date.now();
  try {
    const [{ providers }, { supabaseConfigured }, { pingDb }] = await Promise.all([
      import("@/lib/vaidyam/inference"),
      import("@/lib/vaidyam/supabase"),
      import("@/lib/vaidyam/db-persist"),
    ]);

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
      postgres: database.ok,
      db: {
        configured: database.configured,
        reachable: database.ok,
        required: false,
        ...(database.error ? { error: database.error } : {}),
      },
      sources: FALLBACK_BODY.sources,
    };

    return NextResponse.json(body, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        ...FALLBACK_BODY,
        time: new Date().toISOString(),
        ms: Date.now() - started,
      },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
