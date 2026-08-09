import type { NextRequest } from "next/server";
import { dispatchCatena } from "@/lib/vaidyam/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ route?: string[] }> | { route?: string[] } },
): Promise<Response> {
  const raw = await Promise.resolve(ctx.params);
  const parts = Array.isArray(raw?.route) ? raw.route : [];
  const forced = parts.length ? `/${parts.join("/")}` : undefined;
  return dispatchCatena(request, forced);
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ route?: string[] }> | { route?: string[] } },
) {
  return handle(request, ctx);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ route?: string[] }> | { route?: string[] } },
) {
  return handle(request, ctx);
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ route?: string[] }> | { route?: string[] } },
) {
  return handle(request, ctx);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ route?: string[] }> | { route?: string[] } },
) {
  return handle(request, ctx);
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ route?: string[] }> | { route?: string[] } },
) {
  return handle(request, ctx);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-catena-user,accept",
      "cache-control": "no-store",
    },
  });
}
