# Vaidyam / Catena — SynapseX on Next.js

Full-stack port of [pmrinal2005/Vaidyam](https://github.com/pmrinal2005/Vaidyam) onto **Next.js (App Router) + PostgreSQL (Drizzle)**, ready for **Vercel free tier** with optional **Supabase free tier** Postgres.

## What you get

- **Landing** (`/`) — SynapseX cinematic marketing page (scroll-scrub video, scramble type, metrics carousel, reveal island).
- **Dashboard** (`/dashboard`) — Catena personal causal health twin (overview, graph, swarm, cascade, counterfactuals, privacy/ZK, domain panels).
- **API** (`/api/*`) — the Catena Hono API mounted as a Next.js route handler. Secrets from `process.env`.
- **PostgreSQL** — twin registry + observation / graph snapshot tables via Drizzle (local or Supabase).

## Quick start

```bash
npm install
npx drizzle-kit push
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/dashboard.

## Vercel + Supabase (free tier)

1. Create a free Supabase project → copy the **Postgres connection string** (Session mode / URI).
2. Import this repo in Vercel (framework: **Next.js**).
3. Set environment variables in the Vercel project:
   - `DATABASE_URL` = Supabase Postgres URI (required)
   - Optional: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
   - Optional LLM/data keys: `USDA_API_KEY`, `GROQ_API_KEY`, `NVIDIA_NIM_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`
4. Deploy. Verify:
   - `/api/health` → `{ ok: true, app: "catena" }`
   - `/dashboard` → Twin Overview loads live data (no 404 on `/overview`)

No Cloudflare Pages, Workers, wrangler, or static `dist-static` target. The Next.js build ships real serverless `/api/*` routes so the dashboard is live on first paint.

## Environment

See `.env.example`. Every key except `DATABASE_URL` is optional; without external keys the API uses live CORS-open upstreams (Open-Meteo, openFDA, Europe PMC, disease.sh) and deterministic fallbacks for the rest, labelled in the provenance strip.

## Architecture

```
src/lib/vaidyam/            ← Catena engine (sources, twin, swarm, privacy…)
src/app/api/[[...route]]    ← Hono mount (all Catena routes under /api/*)
src/app/api/health          ← unified platform + dashboard health
src/app/page.tsx            ← SynapseX landing
src/app/dashboard/page.tsx  ← Catena dashboard shell
public/static/              ← CSS + dashboard JS + reveal bundle
src/db/schema.ts            ← Drizzle tables for twin persistence
```

## Dashboard API contract

The dashboard client (`public/static/dash/core.js`) probes same-origin `/api/health` for `{ app: "catena" }`, then loads `/api/overview` and the other panels. All routes are served by this Next.js app — no external worker required.
