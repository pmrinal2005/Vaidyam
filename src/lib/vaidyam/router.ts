/**
 * Minimal dependency-free HTTP router used in place of Hono.
 *
 * This project intentionally ships with ZERO Cloudflare Workers / Hono
 * runtime dependency. All Catena API routes are plain functions registered
 * against static paths and dispatched from Next.js Route Handlers
 * (see src/app/api/[[...route]]/route.ts and src/app/api/*\/route.ts).
 *
 * The `ApiContext` shape below intentionally mirrors the handful of Hono
 * context members the route bodies in `api.ts` were written against
 * (`c.req.query`, `c.req.json`, `c.req.raw`, `c.req.header`, `c.env`,
 * `c.json`) so the large set of route handlers needed no rewriting beyond
 * swapping the router implementation itself.
 */

export type Bindings = Record<string, string | undefined>;

export interface ApiRequest {
  /** Underlying standard Web Request (Next.js Node runtime). */
  raw: Request;
  /** Full request URL string. */
  url: string;
  query(name: string): string | undefined;
  header(name: string): string | undefined;
  json<T = unknown>(): Promise<T>;
}

export interface ApiContext<Env extends Bindings = Bindings> {
  req: ApiRequest;
  env: Env;
  json(payload: unknown): Response;
}

export function createApiContext<Env extends Bindings = Bindings>(
  request: Request,
  env: Env,
): ApiContext<Env> {
  const url = new URL(request.url);
  return {
    req: {
      raw: request,
      url: request.url,
      query: (name: string) => url.searchParams.get(name) ?? undefined,
      header: (name: string) => request.headers.get(name) ?? undefined,
      json: async <T = unknown>() => {
        try {
          return (await request.json()) as T;
        } catch {
          return {} as T;
        }
      },
    },
    env,
    json: (payload: unknown) =>
      Response.json(payload as object, {
        headers: { "cache-control": "no-store" },
      }),
  };
}

type Handler<Env extends Bindings = Bindings> = (
  c: ApiContext<Env>,
) => Promise<Response> | Response;

interface Route<Env extends Bindings = Bindings> {
  method: string;
  path: string;
  handler: Handler<Env>;
}

/** Tiny static-path router — no wildcards/params are needed by this API. */
export class MiniRouter<Env extends Bindings = Bindings> {
  private routes: Route<Env>[] = [];

  get(path: string, handler: Handler<Env>): this {
    this.routes.push({ method: "GET", path, handler });
    return this;
  }

  post(path: string, handler: Handler<Env>): this {
    this.routes.push({ method: "POST", path, handler });
    return this;
  }

  find(method: string, path: string): Handler<Env> | undefined {
    const normalized = path.replace(/\/+$/, "") || "/";
    const route = this.routes.find(
      (r) => r.method === method && r.path === normalized,
    );
    return route?.handler;
  }

  async dispatch(method: string, path: string, c: ApiContext<Env>): Promise<Response> {
    const handler = this.find(method, path);
    if (!handler) {
      return Response.json(
        { ok: false, error: "not_found", path, method },
        { status: 404 },
      );
    }
    try {
      return await handler(c);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { ok: false, error: "internal_error", detail: message.slice(0, 300) },
        { status: 500 },
      );
    }
  }
}
