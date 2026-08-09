# Vaidyam / Catena — Next.js + PostgreSQL (Vercel-ready)

Full-stack **Next.js (App Router)** app with **PostgreSQL via Drizzle**.  
Deploy on the **Vercel free tier**; use local Postgres or **Supabase free tier** for the database.

## Why dashboard 404s happened (and why this repo fixes them)

The previous Vercel deployment served a **static** `dashboard.html` from `public/` / `dist-static` with **no serverless `/api/*` functions**.  
The dashboard client calls same-origin `/api/overview`, `/api/graph`, … — those returned **HTTP 404**, so every panel showed:

> Could not load live data. HTTP 404 on /overview

This codebase is a **pure Next.js** app:

- Landing: `/` (App Router)
- Dashboard: `/dashboard` (App Router shell + static JS panels)
- **Every** Catena endpoint is a real Next.js Route Handler under `src/app/api/**`
- Explicit routes for each panel **plus** a catch-all, so Vercel cannot miss `/api/*`
- No Cloudflare Workers, no Hono, no `outputDirectory: dist-static`, no static HTML shadowing routes

## Quick start

```bash
npm install
npx drizzle-kit push
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/dashboard.

## Fixing the "dist-static" / Output Directory Vercel error

If a Vercel deployment ever fails with:

```
Error: The Next.js output directory "dist-static" was not found at
"/vercel/path0/dist-static".
```

it means the **Vercel Project → Settings → Build & Development Settings →
Output Directory** field has a leftover manual override (from an earlier,
now-removed static/Cloudflare-style build of this project) pointing at
`dist-static`. This repo no longer produces that directory at all — `next
build` always writes to `.next/`, and there is no `build:static` /
`dist-static` script in `package.json` or `scripts/` any more.

Two independent fixes are in place so this cannot recur:

1. `vercel.json` now sets `"outputDirectory": ".next"` explicitly. Per
   Vercel's own precedence rules, an `outputDirectory` in `vercel.json`
   **overrides** whatever is configured in the dashboard, so a stale manual
   override in Project Settings can no longer break the build.
2. All legacy static-export tooling (`scripts/build-static.mjs`,
   `scripts/build-reveal.mjs`, `scripts/build-local-engine.mjs`,
   `scripts/serve-static.mjs`) has been removed — there is nothing left in the
   repo that can produce or reference a `dist-static/` artifact.

If you still see the error after redeploying, open the Vercel dashboard for
the project, go to **Settings → Build and Deployment**, and make sure
"Output Directory" is **not overridden** (toggle it off) so it defers to
`vercel.json`/the Next.js framework preset, then redeploy.

## Deploy on Vercel (free tier)

1. Import this repo into Vercel — Framework Preset: **Next.js** (auto).
2. **Do not** set a custom Output Directory. Leave Build Command as `next build` (see `vercel.json`).
3. Environment variables:
   - `DATABASE_URL` — Postgres URI (optional but recommended; Supabase session pooler works)
   - Optional: `USDA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_NIM_API_KEY`, `SUPABASE_*`, etc. (see `.env.example`)
4. Push schema once against the remote DB:
   ```bash
   DATABASE_URL="<uri>" npx drizzle-kit push
   ```
5. Deploy, then verify:
   - `GET /api/health` → `{ "ok": true, "app": "catena", "host": "nextjs", ... }`
   - `GET /api/overview` → `{ "ok": true, "data": { "kpis": [...] }, "provenance": [...] }`
   - `/dashboard` loads live panels (no 404s)

## API surface (all dynamic)

| Method | Path | Panel |
|--------|------|--------|
| GET | `/api/health` | live chip / probe |
| GET | `/api/overview` | Twin Overview |
| GET | `/api/graph` | Causal graph |
| POST | `/api/swarm` | Agent swarm |
| GET | `/api/cascade` | Draft/verify cascade |
| POST | `/api/counterfactual` | Counterfactual sim |
| GET | `/api/counterfactual/levers` | CF levers |
| GET | `/api/environment` | Environment |
| GET | `/api/medications` | Medications |
| GET | `/api/nutrition` | Nutrition |
| GET/POST | `/api/zk/*` | Privacy / ZK |
| GET | `/api/public-health` | Public health DP |
| GET | `/api/memory` | Memory / quantization |
| GET | `/api/clinician-brief` | Clinician brief |
| GET | `/api/ingestion` | Ingestion |
| GET | `/api/literature` | Literature |
| GET | `/api/saas` | SaaS surfaces |

Live free upstreams (Open-Meteo, openFDA, Europe PMC, disease.sh, …) power panels when reachable; deterministic fallbacks only engage when an upstream fails, and the provenance strip labels the mode.

## Architecture

```
src/app/page.tsx                 Landing (SynapseX)
src/app/dashboard/page.tsx       Dashboard shell
src/app/api/*/route.ts           Explicit Catena endpoints
src/app/api/[...route]/route.ts Catch-all dispatcher
src/lib/vaidyam/api.ts           All business handlers (MiniRouter)
src/lib/vaidyam/dispatch.ts      Shared Next.js → MiniRouter bridge
src/db/schema.ts                 Drizzle tables (twins, observations, …)
public/static/dash/*.js          Dashboard client (calls /api/*)
```

## Local validation

```bash
npx next typegen
npx tsc --noEmit
npm run build
curl -s localhost:3000/api/health
curl -s localhost:3000/api/overview | head
```
