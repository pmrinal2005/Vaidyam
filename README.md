# Vaidyam / Catena — Next.js + PostgreSQL (Vercel-ready)

Full-stack **Next.js (App Router)** app with **PostgreSQL via Drizzle**.  
Deploy on the **Vercel free tier**; use local Postgres or **Supabase free tier** for the database.

## Why the dashboard showed “Could not load live data”

The broken production deployment at `vaidyam-seven.vercel.app` was serving a **static** site (no serverless `/api/*` functions). The dashboard client calls same-origin `/api/overview`, `/api/graph`, … — those returned **HTTP 404**, so every panel failed.

This codebase is a **pure Next.js** app:

- Landing: `/` (App Router)
- Dashboard: `/dashboard` (App Router shell + static JS panels)
- **Every** Catena endpoint is a real Next.js Route Handler under `src/app/api/**`
- Explicit routes for each panel **plus** a catch-all, so Vercel cannot miss `/api/*`
- No Cloudflare Workers, no Hono, no `outputDirectory: dist-static`, no static HTML shadowing routes

## Fixing the Vercel `dist-static` build error

```
Error: The Next.js output directory "dist-static" was not found at
"/vercel/path0/dist-static".
```

**Root cause:** the Vercel project (or an old `vercel.json`) still points **Output Directory** at `dist-static` from a previous static/Cloudflare-style build. Next.js does **not** produce that folder — `next build` writes to `.next/`, and the Vercel Next.js builder consumes it internally.

### Required Vercel project settings

1. **Framework Preset:** `Next.js`
2. **Build Command:** `next build` (or leave default)
3. **Output Directory:** **LEAVE EMPTY / toggle override OFF**  
   Do **not** set `.next`, `dist`, `dist-static`, or `out`.
4. **Install Command:** `npm install`
5. **Root Directory:** repository root (where `package.json` + `next.config.ts` live)

This repo’s `vercel.json`:

- sets `"framework": "nextjs"`
- sets `"buildCommand": "next build"`
- does **NOT** set `outputDirectory` (setting it breaks the Next.js builder)

Also removed: `scripts/build-static.mjs`, `serve-static.mjs`, and any path that could recreate `dist-static/`.

After changing settings: **Redeploy** (Deployments → … → Redeploy, or push a new commit).  
Then verify:

- `GET https://<your-app>.vercel.app/api/health` → `{ "ok": true, "app": "catena", "host": "nextjs", ... }`
- `GET https://<your-app>.vercel.app/api/overview` → envelope with `data.kpis`
- `/dashboard` loads live panels (no “static host” error)

## Quick start (local)

```bash
npm install
npx drizzle-kit push
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/dashboard.

## Environment variables

| Name | Required | Purpose |
|------|----------|---------|
| `DATABASE_URL` | recommended | Postgres (Supabase session pooler works) |
| `USDA_API_KEY` | optional | richer nutrition |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `NVIDIA_NIM_API_KEY` | optional | LLM swarm providers |
| `SUPABASE_URL` + keys | optional | alternate persistence |

Without `DATABASE_URL` the app still runs — twin math + live free upstreams power every panel; DB is best-effort.

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
node scripts/verify.mjs --no-api
# with server up:
BASE=http://127.0.0.1:3000 node scripts/verify.mjs
```
