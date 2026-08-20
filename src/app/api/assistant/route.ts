import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Voice-to-voice Healthcare AI Assistant — Groq Cloud proxy.
 *
 * Model:  qwen/qwen3.6-27b  (Groq OpenAI-compatible chat completions)
 * Scope:  STRICTLY healthcare/medical information only.
 * Cost:   Groq free tier is tight, so every request is kept minimal —
 *         - the system prompt is short,
 *         - only a small trailing slice of prior turns is forwarded,
 *         - max_completion_tokens is capped low,
 *         - the model is instructed to answer in a few crisp sentences.
 *
 * The GROQ_API_KEY is read server-side only and is never exposed to the client.
 */

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "qwen/qwen3.6-27b";

// Short, strict system instruction. Kept compact on purpose (fewer input tokens).
const SYSTEM_PROMPT =
  "You are Vaidyam, a warm, empathetic healthcare information assistant. " +
  "ONLY answer healthcare and medical questions. If the user asks about anything " +
  "non-medical (coding, weather, general trivia, math, etc.), politely decline in ONE " +
  "sentence and steer them back to a health topic. " +
  "Reply in at most 3 short, crisp sentences — plain spoken language, no markdown, no lists, no headings. " +
  "End every medical reply with a brief note: 'This is general info, not a substitute for professional medical advice.'";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** Cap a string to protect the token budget. */
function cap(s: unknown, max: number): string {
  const str = typeof s === "string" ? s.trim() : "";
  return str.length > max ? str.slice(0, max) : str;
}

export async function POST(request: NextRequest) {
  const key = process.env.GROQ_API_KEY;

  let payload: { message?: string; history?: ChatMsg[] } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const message = cap(payload.message, 500);
  if (!message) {
    return NextResponse.json(
      { ok: false, error: "Empty message." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  // ── Token-frugal context: forward only the last 2 exchanges (<=4 msgs),
  //    each individually capped. This preserves memory while keeping the
  //    input tiny for the Groq free tier.
  const rawHistory = Array.isArray(payload.history) ? payload.history : [];
  const trimmedHistory: ChatMsg[] = rawHistory
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-4)
    .map((m) => ({ role: m.role, content: cap(m.content, 300) }));

  const messages: ChatMsg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...trimmedHistory,
    { role: "user", content: message },
  ];

  // No key configured → deterministic, safe fallback (keeps the UI usable in dev).
  if (!key) {
    return NextResponse.json(
      {
        ok: true,
        degraded: true,
        reply:
          "The healthcare assistant isn't connected to the AI service yet (no GROQ_API_KEY set). " +
          "Once configured, I can answer your health questions. " +
          "This is general info, not a substitute for professional medical advice.",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    const res = await fetch(GROQ_BASE, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.6,
        // Kept low: crisp spoken answers cost far fewer tokens than 2048.
        max_completion_tokens: 220,
        top_p: 0.95,
        stream: false,
        reasoning_effort: "default",
        stop: null,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const status = res.status;
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error:
            status === 429
              ? "The AI service is rate-limited right now. Please wait a moment and try again."
              : `Groq API error (${status}).`,
          detail: cap(detail, 300),
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }

    const j: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } = await res.json();

    let reply = cap(j?.choices?.[0]?.message?.content, 1200);
    // Some reasoning models wrap chain-of-thought in <think>…</think>. Strip it.
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    if (!reply) {
      return NextResponse.json(
        {
          ok: true,
          degraded: true,
          reply:
            "I couldn't generate a response just now. Please try rephrasing your health question. " +
            "This is general info, not a substitute for professional medical advice.",
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        reply,
        usage: {
          in: Number(j?.usage?.prompt_tokens || 0),
          out: Number(j?.usage?.completion_tokens || 0),
        },
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error && err.name === "AbortError"
            ? "The AI service took too long to respond. Please try again."
            : "Could not reach the AI service. Please try again.",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-catena-user,accept",
      "cache-control": "no-store",
    },
  });
}
