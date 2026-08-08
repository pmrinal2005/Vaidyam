/**
 * Next.js App Router catch-all — mounts the Catena/Vaidyam API at /api/*.
 *
 * Runs on the Node.js runtime (Vercel serverless / local `next start`).
 * Secrets come from process.env. No Cloudflare Workers/Pages, no Hono —
 * this is a plain Next.js Route Handler dispatching to the MiniRouter
 * defined in src/lib/vaidyam/api.ts.
 */
import type { NextRequest } from "next/server";
import api from "@/lib/vaidyam/api";
import { createApiContext } from "@/lib/vaidyam/router";
import type { Bindings } from "@/lib/vaidyam/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENV_KEYS = [
  "USDA_API_KEY",
  "GROQ_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
  "DATABASE_URL",
] as const;

function envFromProcess(): Bindings {
  const out: Record<string, string> = {};
  for (const k of ENV_KEYS) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out as Bindings;
}

async function handleRequest(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  // Strip the /api prefix — the MiniRouter registers routes like "/health".
  let path = url.pathname.replace(/^\/api/, "");
  if (!path) path = "/";
  const ctx = createApiContext<Bindings>(request, envFromProcess());
  return api.dispatch(request.method, path, ctx);
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-catena-user",
    },
  });
}
