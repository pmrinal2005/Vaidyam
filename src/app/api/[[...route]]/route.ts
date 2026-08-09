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

function normalizePath(pathname: string): string {
  let path = pathname.replace(/^\/api/, "") || "/";
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  return path || "/";
}

async function handleRequest(request: NextRequest): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const ctx = createApiContext<Bindings>(request, envFromProcess());
    const res = await api.dispatch(request.method, path, ctx);
    const headers = new Headers(res.headers);
    headers.set("cache-control", "no-store");
    headers.set("access-control-allow-origin", "*");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: "internal_error", detail: message.slice(0, 300) },
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
      },
    );
  }
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
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-catena-user",
      "cache-control": "no-store",
    },
  });
}
