import type { NextRequest } from "next/server";
import { dispatchCatena } from "@/lib/vaidyam/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return dispatchCatena(request, "/overview");
}

export async function POST(request: NextRequest) {
  return dispatchCatena(request, "/overview");
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
