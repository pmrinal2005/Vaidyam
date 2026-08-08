# Vaidyam / Catena — Next.js on Vercel + Supabase Postgres

Full-stack rebuild of [pmrinal2005/Vaidyam](https://github.com/pmrinal2005/Vaidyam) as a single
**Next.js (App Router)** application with **PostgreSQL via Drizzle**. Ready for the
**Vercel free tier**, with the **Supabase free tier** as the recommended Postgres host.

There is **no Cloudflare Pages / Workers / wrangler / Hono** anywhere in this project. All
`/api/*` routes are plain Next.js Route Handlers running on the Node.js runtime, so the
dashboard's API calls are always answered by real serverless functions on Vercel — no external
worker, no static-host fallback, no 404s.

## What you get

- **Landing** (`/`) — SynapseX cinematic marketing page.
- **Dashboard** (`/dashboard`) — Catena personal causal health twin: overview, causal graph,
  agent swarm, draft/verify cascade, counterfactual simulator, privacy/ZK attestations, and
  domain panels (medications, nutrition, environment, clinician brief, ingestion, SaaS).
- **API** (`/api/*`) — 19 routes implemented as plain TypeScript functions in
  `src/lib/vaidyam/api.ts`, dispatched by a tiny dependency-free router
  (`src/lib/vaidyam/router.ts`) — no Hono, no Cloudflare bindings.
- **PostgreSQL** — twin registry + observation / graph snapshot tables via Drizzle ORM (local
  Postgres or Supabase).

## Quick start

```bash
npm install
npx drizzle-kit push
npm run dev
```

Open <http://localhost:3000> and <http://localhost:3000/dashboard>.

## Deploy: Vercel (app) + Supabase (database) — both free tier

1. **Database** — create a free [Supabase](https://supabase.com) project → Settings →
   Database → Connection string → copy the **URI** (session pooler, port 5432 or 6543).
2. **Import** this repository into [Vercel](https://vercel.com) → Framework Preset: **Next.js**
   (auto-detected).
3. **Environment variables** — in the Vercel project settings, add:
   - `DATABASE_URL` = the Supabase Postgres URI (**required**)
   - Everything else in `.env.example` is optional — copy it as a starting point.
4. **Push the schema** once, from your machine, pointed at the Supabase database:
   ```bash
   DATABASE_URL="<your supabase uri>" npx drizzle-kit push
   ```
5. **Deploy.** Then verify:
   - `GET /api/health` → `{ ok: true, app: "catena", ... }`
   - `/dashboard` → the Twin Overview loads live data immediately (no 404s on `/overview`,
     `/graph`, `/swarm`, `/cascade`, `/counterfactual`, `/environment`, `/medications`,
     `/nutrition`, `/zk/*`, `/public-health`, `/memory`, `/clinician-brief`, `/ingestion`,
     `/literature`, or `/saas`).

No Cloudflare Pages, Workers, wrangler, or static `dist-static` build target is used or required.

## Environment variables

See [`.env.example`](./.env.example) for the full, documented list. Only `DATABASE_URL` is
required. Every other key (Supabase REST, USDA, GROQ, NVIDIA NIM, OpenRouter, generic OpenAI
proxy) is optional — the API composes free, CORS-open, keyless upstreams (Open-Meteo, openFDA,
Europe PMC, disease.sh) with deterministic fallbacks, and always labels which mode each panel is
in via the provenance strip at the top of the dashboard.

## Architecture

```
src/lib/vaidyam/            ← Catena engine: sources, twin, swarm, privacy, counterfactuals…
src/lib/vaidyam/router.ts   ← Dependency-free MiniRouter (replaces Hono)
src/lib/vaidyam/api.ts      ← All 19 Catena API routes (plain TS functions)
src/app/api/[[...route]]    ← Next.js catch-all Route Handler that dispatches into api.ts
src/app/api/health          ← Unified platform + dashboard health check (DB + providers)
src/app/page.tsx            ← SynapseX landing page
src/app/dashboard/page.tsx  ← Catena dashboard shell
public/static/              ← Dashboard/landing CSS + client JS (no build step required)
src/db/schema.ts            ← Drizzle tables for twin persistence (Postgres / Supabase)
```

## Dashboard API contract

The dashboard client (`public/static/dash/core.js`) resolves its API base in this order:
`?api=` override → `<meta name="catena-api-base">` → `window.CATENA_API_BASE` → remembered
`localStorage` override → same-origin `/api`. On this Next.js build, same-origin `/api` always
answers — every panel (Overview, Graph, Swarm, Cascade, Counterfactual, Privacy/ZK, Environment,
Medications, Nutrition, Clinician Brief, Ingestion, SaaS) is backed by a real serverless route, so
the "no Catena API reachable" / "no `/api` worker" error from the old static-hosting build cannot
occur here.

## Local database

```bash
psql postgresql://postgres:postgres@127.0.0.1:5432/app_db -c "select 1"
npx drizzle-kit push
```

## Removed from the original repo

This rebuild intentionally removes every Cloudflare/Hono-era artifact from the upstream project:
`wrangler.jsonc`, `.dev.vars*`, `ecosystem.config.cjs`, `vite*.config.ts`, `dist-static/`,
`src/index.tsx` / `src/renderer.tsx` (Hono JSX Cloudflare Worker entry), the top-level
`api/[[...route]].ts` Cloudflare Pages Function, the legacy `src/api/index.ts` Hono app, and the
`hono` / `hono/vercel` npm dependency itself. All business logic (causal graph, swarm, privacy,
counterfactuals, live data sources) is preserved unchanged in `src/lib/vaidyam/`.
