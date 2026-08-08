/**
 * Next.js App Router catch-all — mounts the Catena/Vaidyam Hono API at /api/*.
 *
 * Runs on the Node.js runtime (Vercel serverless / local `next start`).
 * Secrets come from process.env and are injected into c.env so src/lib/vaidyam
 * stays host-agnostic (reads c.env.GROQ_API_KEY etc.).
 *
 * No Cloudflare Workers / Pages / wrangler dependency — pure Next.js + Postgres.
 */
import { Hono } from "hono";
import { handle } from "hono/vercel";
import api from "@/lib/vaidyam/api";
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
  try {
    const src =
      typeof process !== "undefined" && process.env
        ? (process.env as Record<string, string | undefined>)
        : {};
    for (const k of ENV_KEYS) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
  } catch {
    /* empty env degrades gracefully */
  }
  return out as Bindings;
}

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.use("*", async (c, next) => {
  (c as { env?: Bindings }).env = {
    ...envFromProcess(),
    ...((c as { env?: Bindings }).env || {}),
  };
  await next();
});

app.route("/", api);

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
