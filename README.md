# Vaidyam / Catena — SynapseX on Next.js

Full-stack port of [pmrinal2005/Vaidyam](https://github.com/pmrinal2005/Vaidyam) onto **Next.js (App Router) + PostgreSQL (Drizzle)**, ready for **Vercel**.

## What you get

- **Landing** (`/`) — SynapseX cinematic marketing page (scroll-scrub video, scramble type, metrics carousel, reveal island).
- **Dashboard** (`/dashboard`) — Catena personal causal health twin (overview, graph, swarm, cascade, counterfactuals, privacy/ZK, domain panels).
- **API** (`/api/*`) — the original Hono Catena edge API, mounted as a Next.js route handler with secrets from `process.env`.
- **PostgreSQL** — optional twin registry + observation / graph snapshot tables via Drizzle.

## Quick start

```bash
npm install
npx drizzle-kit push
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/dashboard.

## Vercel deployment

1. Import the repo in Vercel (framework: **Next.js** — auto-detected via `vercel.json`).
2. Set `DATABASE_URL` to your Postgres connection string (Neon/Supabase/Vercel Postgres).
3. Optionally set any of: `USDA_API_KEY`, `GROQ_API_KEY`, `NVIDIA_NIM_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `SUPABASE_*`.
4. Deploy. `/api/health` must return `{ ok: true, app: "catena" }`.

No special `outputDirectory` is needed — unlike the original static `dist-static` target, this build ships real serverless `/api/*` routes so the dashboard is live on first paint.

## Environment

See `.env.example`. Every key is optional; without keys the API uses live CORS-open upstreams (Open-Meteo, openFDA, Europe PMC, disease.sh) and deterministic fallbacks for the rest, labelled in the provenance strip.

## Architecture

```
src/lib/vaidyam/     ← original Catena engine (sources, twin, swarm, privacy…)
src/app/api/[[...route]]  ← Hono mount (all Catena routes)
src/app/api/health        ← unified platform + dashboard health
src/app/page.tsx          ← SynapseX landing
src/app/dashboard/page.tsx
public/static/            ← CSS + dashboard JS + reveal bundle
src/db/schema.ts          ← Drizzle tables for twin persistence
```
