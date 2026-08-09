import type { NextRequest } from "next/server";
import api from "@/lib/vaidyam/api";
import { createApiContext } from "@/lib/vaidyam/router";
import type { Bindings } from "@/lib/vaidyam/types";

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

function corsHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra || {});
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type,x-catena-user,accept",
  );
  return headers;
}

/**
 * Dispatch a Catena API call against the MiniRouter.
 * `forcedPath` lets explicit Next route files pin the path (e.g. "/overview")
 * so URL rewriting / basePath quirks cannot 404 a known endpoint.
 */
export async function dispatchCatena(
  request: NextRequest | Request,
  forcedPath?: string,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    let path =
      forcedPath ||
      url.pathname.replace(/^\/api/, "") ||
      "/";
    path = path.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    if (!path.startsWith("/")) path = `/${path}`;

    const ctx = createApiContext<Bindings>(request, envFromProcess());
    const res = await api.dispatch(request.method, path || "/", ctx);
    const headers = corsHeaders(res.headers);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: "internal_error", detail: message.slice(0, 300) },
      { status: 500, headers: corsHeaders() },
    );
  }
}
