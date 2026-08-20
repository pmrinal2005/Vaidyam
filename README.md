# Vaidyam — Your Personal Causal Health Twin

> *"The AI that sees why you're sick before you do."*

Vaidyam (internally also referred to by its engine codename **Catena**) is a
full-stack, AI-driven **digital health twin** platform. It continuously builds
a personal **causal knowledge graph** from environmental, physiological,
medication, sleep, mood and nutrition signals, reasons over that graph with a
**free multi-agent LLM swarm**, simulates **"what-if" interventions**, and
lets you *prove* health claims to third parties (insurers, employers,
clinicians) using **zero-knowledge attestations** and **differential privacy**
— all without your raw data ever leaving the twin.

It is built as a single **Next.js (App Router) application**: one deployable
unit that serves the marketing landing page, the live dashboard, and every
API endpoint as real serverless Route Handlers — no separate backend, no
Cloudflare Worker, no Hono runtime.

---

## Table of contents

1. [Project overview](#project-overview)
2. [Why this architecture](#why-this-architecture)
3. [Conceptual model — the six layers](#conceptual-model--the-six-layers)
4. [Technical architecture](#technical-architecture)
5. [Project structure](#project-structure)
6. [Data model (PostgreSQL / Drizzle)](#data-model-postgresql--drizzle)
7. [API surface](#api-surface)
8. [Frontend surfaces](#frontend-surfaces)
9. [External data sources & graceful degradation](#external-data-sources--graceful-degradation)
10. [Multi-agent inference (LLM swarm & cascade)](#multi-agent-inference-llm-swarm--cascade)
11. [Counterfactual simulation engine](#counterfactual-simulation-engine)
12. [Privacy layer — ZK attestations & differential privacy](#privacy-layer--zk-attestations--differential-privacy)
13. [Determinism & reproducibility](#determinism--reproducibility)
14. [Getting started locally](#getting-started-locally)
15. [Environment variables](#environment-variables)
16. [Database setup](#database-setup)
17. [Available scripts](#available-scripts)
18. [Validation & testing](#validation--testing)
19. [Deployment](#deployment)
20. [Tech stack summary](#tech-stack-summary)
21. [Design principles](#design-principles)
22. [Roadmap ideas](#roadmap-ideas)
23. [License](#license)

---

## Project overview

| | |
|---|---|
| **Name** | Vaidyam (engine codename: *Catena*) |
| **Type** | Full-stack web application (Next.js App Router, single deployable) |
| **Domain** | Personal preventive-health / digital-twin analytics |
| **Frontend** | Server-rendered React landing page + a vanilla-JS single-page dashboard shell |
| **Backend** | Next.js Route Handlers acting as a REST API (`/api/*`) |
| **Database** | PostgreSQL via Drizzle ORM (optional — the app degrades gracefully without it) |
| **AI layer** | Multi-provider LLM swarm (Groq, NVIDIA NIM, OpenRouter, generic OpenAI-compatible proxy) with a deterministic local fallback reasoner |
| **Privacy layer** | Zero-knowledge-style attestations + differential-privacy aggregation, computed locally |
| **Hosting target** | Vercel free tier (or any Node.js host); local PostgreSQL or Supabase free tier for storage |

Vaidyam presents itself to the user as two experiences built on one codebase:

- **`/` — the landing page**: a cinematic marketing site (React/Next.js server
  component) explaining the product, with a hero video, scroll-reveal
  animations, and a call-to-action ("Enter Your Twin") into the dashboard.
- **`/dashboard` — the live twin**: a client-rendered analytics cockpit with
  a left navigation rail, a topbar, and a dozen data panels (Overview, Causal
  Graph, Agent Swarm, Cascade, Counterfactual Simulator, Environment,
  Medications, Nutrition, Privacy/ZK, Public Health, Memory, Clinician Brief,
  Ingestion, Literature, SaaS). Every panel is powered by a same-origin
  `/api/*` call.

---

## Why this architecture

The original project went through several deployment iterations (documented
in `DIAGNOSIS.md`), including a Cloudflare Workers + Hono backend and a
static-export build. Both produced broken production deployments because the
dashboard's client-side JavaScript always calls same-origin `/api/*` — if the
hosting target doesn't run a real server (e.g. a static export on Vercel),
every one of those calls 404s and the whole dashboard shows
**"Could not load live data."**

This codebase resolves that permanently by being a **pure Next.js
application**:

- The landing page and dashboard shell are Next.js pages (`src/app/page.tsx`,
  `src/app/dashboard/page.tsx`).
- **Every** API endpoint is a real Next.js Route Handler under
  `src/app/api/**/route.ts`, each one running in the Node.js runtime (not the
  Edge runtime) because it depends on `pg`/Drizzle and outbound `fetch` calls
  to third-party APIs with generous timeouts.
- A catch-all route (`src/app/api/[...route]/route.ts`) exists as a safety
  net so no `/api/*` path can ever be missed regardless of routing/rewrite
  quirks.
- `next.config.ts` explicitly avoids static export and pins
  `serverExternalPackages: ["pg", "drizzle-orm"]` so the database driver is
  never bundled for an edge runtime.
- `vercel.json` intentionally leaves `outputDirectory` unset (`null`) so the
  platform's own Next.js builder consumes `.next/` — nothing points at a
  stale `dist-static` folder from a previous static-export build.

---

## Conceptual model — the six layers

Vaidyam's backend logic (`src/lib/vaidyam/*`) is organized around six
conceptual layers of a "digital twin" pipeline, referenced directly in code
comments:

| Layer | Concern | Implementation |
|-------|---------|-----------------|
| **0 — Ingestion** | Pull live, free, keyless external data (weather, air quality, drug-safety signals, literature, population health) | `src/lib/vaidyam/sources.ts` |
| **1 — Twin construction** | Collapse raw streams into a 30-day physiological time series and a weighted **Personal Causal Knowledge Graph** | `src/lib/vaidyam/twin.ts` |
| **2 — Multi-Agent Swarm (MoA)** | A "forest" of domain-specialist agents (medication, sleep, environment, mental health, nutrition) each vote on a query, arbitrated by a synthesis coordinator | `src/lib/vaidyam/inference.ts` |
| **3 — Draft/Verify Speculative Cascade** | A FrugalGPT-style router decides, per query, how far up a fast→slow model cascade to escalate (draft → verify → swarm vote), balancing latency, cost, and confidence | `src/lib/vaidyam/inference.ts` |
| **4 — Counterfactual simulation** | "What-if" interventions perturb the causal graph (`do(X=x)` in the do-calculus sense) and propagate effects forward along measured edge lags/strengths | `src/lib/vaidyam/counterfactual.ts` |
| **5 — Privacy & verifiability** | Zero-knowledge-style attestations (public output + proof digest, no raw series ever leaves the twin) and differentially-private aggregation for population-health rollups | `src/lib/vaidyam/privacy.ts` |

This layering means the dashboard is never a static mock: every panel is
either backed by a **live upstream API**, a **deterministic model computed
from that live data**, or — only when both are unavailable — a fully
reproducible **seeded synthetic fallback**, and the UI's provenance strip
always tells you which.

---

## Technical architecture

```
                        ┌─────────────────────────────────────────┐
                        │              Browser                     │
                        │  /            /dashboard                 │
                        │  (SSR React)  (client shell + vanilla JS) │
                        └───────────────┬───────────────────────────┘
                                        │ fetch('/api/…')
                                        ▼
                  ┌──────────────────────────────────────────────────┐
                  │            Next.js App Router (Node runtime)      │
                  │                                                     │
                  │  src/app/api/<endpoint>/route.ts  (18 explicit)     │
                  │  src/app/api/[...route]/route.ts  (catch-all)       │
                  │                    │                                │
                  │                    ▼                                │
                  │       src/lib/vaidyam/dispatch.ts                   │
                  │   (NextRequest → MiniRouter ApiContext bridge,      │
                  │    CORS headers, env allow-list)                    │
                  │                    │                                │
                  │                    ▼                                │
                  │        src/lib/vaidyam/router.ts (MiniRouter)       │
                  │   dependency-free Hono-shaped router/dispatcher     │
                  │                    │                                │
                  │                    ▼                                │
                  │           src/lib/vaidyam/api.ts                    │
                  │   19 route handlers = the entire business logic     │
                  └───────┬───────────────┬────────────────┬───────────┘
                          │               │                │
             ┌────────────▼───┐  ┌────────▼────────┐ ┌────▼─────────────┐
             │ sources.ts      │  │ twin.ts          │ │ inference.ts      │
             │ live free APIs: │  │ 30-day vitals +  │ │ LLM swarm +       │
             │ Open-Meteo,     │  │ causal graph +    │ │ draft/verify      │
             │ openFDA,        │  │ medications        │ │ cascade + router  │
             │ Europe PMC,     │  └────────┬────────┘ └────┬─────────────┘
             │ disease.sh,     │           │                │
             │ USDA FDC        │           ▼                ▼
             └────────┬────────┘  ┌─────────────────┐ ┌──────────────────┐
                      │           │ counterfactual.ts│ │ privacy.ts        │
                      │           │ do-calculus-style │ │ ZK attestations + │
                      │           │ lever simulation   │ │ DP aggregation    │
                      │           └─────────────────┘ └──────────────────┘
                      ▼
             ┌─────────────────────────┐
             │ db-persist.ts / db/*     │
             │ optional PostgreSQL      │
             │ via Drizzle ORM          │
             │ (best-effort, never      │
             │  throws if absent)       │
             └─────────────────────────┘
```

**Key architectural decisions:**

1. **No external web framework in the API layer.** Instead of Hono/Express,
   `src/lib/vaidyam/router.ts` implements a tiny, dependency-free
   `MiniRouter` whose `ApiContext` shape (`c.req.query`, `c.req.json`,
   `c.env`, `c.json`) intentionally mirrors Hono's context API. This let the
   ~940-line business-logic file (`api.ts`) be ported from an earlier
   Cloudflare Workers/Hono implementation with no rewrite of the route
   bodies — only the router underneath changed.
2. **Every route handler is dynamic.** `src/app/api/*/route.ts` files are
   thin (≈26 lines each): they import `dispatchCatena` from
   `src/lib/vaidyam/dispatch.ts`, force a specific path (so basePath/rewrite
   quirks can never 404 a known endpoint), and forward `GET`/`POST`.
3. **Environment bindings are normalized once.** `dispatch.ts` reads a fixed
   allow-list of `process.env` keys into a `Bindings` object so the same
   `api.ts` code can run unmodified whether the underlying host is Next.js,
   a Cloudflare Worker, or a local Node script.
4. **The database is always optional.** `src/db/index.ts` exposes lazy
   `getPool()` / `getDb()` accessors that return `null` when `DATABASE_URL`
   is unset instead of throwing at import time. `db-persist.ts` wraps every
   query so a missing/unreachable database degrades to a non-live
   provenance entry rather than a 500.
5. **Provenance-first responses.** Every API response is wrapped in a typed
   `Envelope<T>` (`{ ok, data, provenance, degraded, ms }`). The `provenance`
   array records, per upstream call, whether it was live and how long it
   took — the dashboard's UI reads this directly to render a "live" vs.
   "fallback" badge per panel, so the system's honesty about its own data
   quality is a first-class API contract, not an afterthought.

---

## Project structure

```
.
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── layout.tsx                    # Root HTML shell, fonts, metadata
│   │   ├── page.tsx                      # Landing page ("/") — SSR marketing site
│   │   ├── globals.css                   # Tailwind entry + minimal reset
│   │   ├── dashboard/
│   │   │   └── page.tsx                  # Dashboard shell ("/dashboard") — mounts vanilla-JS SPA
│   │   └── api/
│   │       ├── health/route.ts           # GET  /api/health
│   │       ├── overview/route.ts         # GET  /api/overview
│   │       ├── graph/route.ts            # GET  /api/graph
│   │       ├── swarm/route.ts            # POST /api/swarm
│   │       ├── cascade/route.ts          # GET  /api/cascade
│   │       ├── counterfactual/route.ts   # POST /api/counterfactual
│   │       ├── counterfactual/levers/route.ts
│   │       ├── environment/route.ts      # GET  /api/environment
│   │       ├── medications/route.ts      # GET  /api/medications
│   │       ├── nutrition/route.ts        # GET  /api/nutrition
│   │       ├── zk/claims/route.ts        # GET  /api/zk/claims
│   │       ├── zk/prove/route.ts         # POST /api/zk/prove
│   │       ├── zk/verify/route.ts        # GET  /api/zk/verify
│   │       ├── public-health/route.ts    # GET  /api/public-health
│   │       ├── memory/route.ts           # GET  /api/memory
│   │       ├── clinician-brief/route.ts  # GET  /api/clinician-brief
│   │       ├── ingestion/route.ts        # GET  /api/ingestion
│   │       ├── literature/route.ts       # GET  /api/literature
│   │       ├── saas/route.ts             # GET  /api/saas
│   │       └── [...route]/route.ts       # catch-all safety net for /api/*
│   │
│   ├── lib/vaidyam/                      # All business logic (host-agnostic)
│   │   ├── types.ts                      # Shared contracts: Envelope, CausalGraph, SwarmAgent, …
│   │   ├── router.ts                     # MiniRouter — dependency-free Hono-shaped router
│   │   ├── dispatch.ts                   # NextRequest ⇄ MiniRouter bridge, CORS, env allow-list
│   │   ├── api.ts                        # 19 route handlers — the entire API surface
│   │   ├── sources.ts                    # Live external data fetchers + graceful degradation
│   │   ├── twin.ts                       # Vitals synthesis + causal-graph construction + PPR
│   │   ├── inference.ts                  # LLM swarm, draft/verify cascade, FrugalGPT router
│   │   ├── counterfactual.ts             # Do-calculus-style lever simulation
│   │   ├── privacy.ts                    # ZK-style attestations + differential privacy
│   │   ├── db-persist.ts                 # Best-effort optional Postgres persistence
│   │   ├── supabase.ts                   # Optional Supabase REST client (alt. persistence)
│   │   └── rand.ts                       # Deterministic PRNG/hash (fnv1a, mulberry32, seeded)
│   │
│   ├── db/
│   │   ├── index.ts                      # Drizzle client — lazy getPool()/getDb(), never throws
│   │   └── schema.ts                     # Drizzle table definitions (twins, observations, …)
│   │
│   ├── components/reveal/                # React port of the landing-page scroll-reveal effect
│   │   ├── RevealStage.tsx
│   │   └── OrbitImages.tsx / .css
│   │
│   ├── reveal/                           # Standalone Vite/React source for the compiled reveal bundle
│   │   ├── App.tsx, main.tsx, index.css
│   │   └── components/OrbitImages.tsx / .css
│   │
│   └── local/
│       └── engine.ts                     # Thin re-export used by the browser local-engine fallback
│
├── public/
│   ├── images/orbit-*.jpg                # Landing-page orbit imagery
│   ├── robots.txt
│   └── static/
│       ├── styles.css, style.css         # Landing page styles
│       ├── app.js                        # Landing page interactions (nav, scroll reveal, video)
│       ├── dashboard.css                 # Dashboard shell + panel styling
│       ├── dash/
│       │   ├── core.js                   # fetch('/api/…') wrapper, caching, provenance rendering
│       │   ├── charts.js                 # Canvas/SVG chart primitives (no chart library dependency)
│       │   ├── local-engine.js           # In-browser deterministic fallback if the API is unreachable
│       │   ├── views-core.js             # Overview, Ingestion, SaaS panel definitions
│       │   ├── views-domain.js           # Environment, Medications, Nutrition, Clinician Brief panels
│       │   ├── views-privacy.js          # ZK / Privacy / Public-health / Memory panels
│       │   ├── views-reason.js           # Causal Graph, Swarm, Cascade, Counterfactual panels
│       │   └── app.js                    # Boots the SPA shell, router between views
│       └── reveal/                       # Compiled output of src/reveal (built by scripts/build-reveal.mjs)
│
├── scripts/
│   ├── build-reveal.mjs                  # Bundles src/reveal/* into public/static/reveal/*
│   ├── build-local-engine.mjs            # Bundles src/local/engine.ts into public/static/dash/local-engine.js
│   ├── build-static.mjs                  # (legacy) static-export helper — NOT used by the Next.js build
│   ├── serve-static.mjs                  # (legacy) static-file server — NOT used in production
│   └── verify.mjs                        # End-to-end smoke test: API responses + required static assets
│
├── supabase/
│   └── schema.sql                        # SQL schema mirror for an optional Supabase deployment
│
├── src/db/schema.ts                      # Canonical schema — source of truth for `drizzle-kit push`
├── drizzle.config.json                   # Drizzle Kit config (dialect, schema path, local DB URL)
├── next.config.ts                        # No static export; Node-only packages excluded from bundling
├── vercel.json                           # Explicit Next.js framework preset; empty output directory
├── tsconfig.json                         # Strict TypeScript config (excludes src/reveal, scripts)
├── eslint.config.mjs                     # Flat ESLint config (next/core-web-vitals)
├── postcss.config.mjs                    # Tailwind v4 PostCSS plugin
├── .env.example / .dev.vars.example      # Documented environment variable templates
├── DIAGNOSIS.md                          # Root-cause analysis of historical deployment defects
└── README.md                             # This file
```

---

## Data model (PostgreSQL / Drizzle)

Schema source of truth: `src/db/schema.ts`. Applied with `npx drizzle-kit
push` (no migration files — the schema is pushed directly, matching this
template's workflow).

| Table | Purpose | Notable columns |
|-------|---------|------------------|
| **`twins`** | One row per user's digital twin | `external_uid` (unique client id), `display_name`, `graph_version`, `home_lat/lon`, `city`, `country`, `consent_dp`, `consent_pharma` |
| **`observations`** | Daily physiological/environmental observation used to re-estimate causal edges | `sleep_hours`, `sleep_efficiency`, `deep_sleep_pct`, `rem_pct`, `resting_hr`, `hrv`, `spo2`, `steps`, `systolic`/`diastolic`, `mood`, `stress`, `glucose`, `sodium_mg`, `hydration_ml`, `adherence`, `symptom_load`, `pm25`, `aqi`, `screen_min`, `respiratory_rate`, `payload` (jsonb), unique on `(external_uid, day)` |
| **`graph_snapshots`** | Versioned snapshot of a twin's causal graph | `version`, `node_count`, `edge_count`, `graph` (jsonb) |
| **`swarm_runs`** | Telemetry for each multi-agent swarm invocation | `query`, `result` (jsonb), `latency_ms` |
| **`attestations`** | Zero-knowledge / DP privacy artefacts issued for a twin | `claim_id`, `public_output` (jsonb), `proof_hash`, `window_days` |
| **`simulations`** | History of counterfactual "what-if" runs | `levers` (jsonb), `horizon_days`, `result` (jsonb) |
| **`api_events`** | Lightweight audit log of API calls (health/overview probes) | `route`, `external_uid`, `ok`, `ms`, `detail` |

All persistence is **best-effort**: `src/lib/vaidyam/db-persist.ts` and
`src/db/index.ts` are written so a missing `DATABASE_URL`, an unreachable
host, or an un-migrated schema all degrade to `null`/non-live provenance
instead of throwing — the dashboard's numbers are computed live from the
twin model regardless of whether the database is present. An alternate
persistence path via **Supabase's REST API** is also available
(`src/lib/vaidyam/supabase.ts`, schema mirrored in `supabase/schema.sql`) for
deployments that prefer Supabase over a direct Postgres connection string.

---

## API surface

All endpoints live under `/api/*`, are same-origin, and return a JSON
`Envelope<T>` (`{ ok, data, provenance[], degraded, ms }`) — see
`src/lib/vaidyam/types.ts`.

| Method | Path | Dashboard panel | Description |
|--------|------|------------------|--------------|
| GET | `/api/health` | Live status chip | Reports provider/DB/upstream reachability |
| GET | `/api/overview` | Twin Overview | KPI summary derived from the 30-day vitals series |
| GET | `/api/graph` | Causal Graph | Personal causal knowledge graph (nodes, edges, communities, PageRank) |
| POST | `/api/swarm` | Agent Swarm | Runs the multi-agent domain-specialist swarm against a free-text query |
| GET | `/api/cascade` | Draft/Verify Cascade | Shows the FrugalGPT-style draft→verify→vote routing decision |
| POST | `/api/counterfactual` | Counterfactual Simulator | Runs a "what-if" lever intervention through the causal graph |
| GET | `/api/counterfactual/levers` | Counterfactual Simulator | Lists available intervention levers with bounds |
| GET | `/api/environment` | Environment | Live Open-Meteo weather + air-quality readings for the twin's location |
| GET | `/api/medications` | Medications | Medication list, adherence, next-dose scheduling, openFDA signal |
| GET | `/api/nutrition` | Nutrition | USDA FoodData Central nutrition lookups (or deterministic estimator) |
| GET | `/api/zk/claims` | Privacy / ZK | Lists provable claim definitions (e.g. adherence ≥ 90%) |
| POST | `/api/zk/prove` | Privacy / ZK | Produces a zero-knowledge-style attestation for a claim |
| GET | `/api/zk/verify` | Privacy / ZK | Verifies a previously issued attestation |
| GET | `/api/public-health` | Public Health | Differentially-private population-health aggregate rollups |
| GET | `/api/memory` | Memory | Storage/quantization budget accounting for the twin |
| GET | `/api/clinician-brief` | Clinician Brief | Generates a structured clinical summary from the twin |
| GET | `/api/ingestion` | Ingestion | Layer-0 pipeline throughput and source-feed provenance |
| GET | `/api/literature` | Literature | Europe PMC / PubMed-mirrored literature relevant to the twin's graph |
| GET | `/api/saas` | SaaS Surfaces | Modelled multi-sided business metrics (ARR, cost stack) |
| POST | `/api/assistant` | AI Assistant | Voice-to-voice healthcare assistant — Groq Cloud proxy (`qwen/qwen3.6-27b`), health-only, short/low-token responses |
| ANY | `/api/[...route]` | — | Catch-all dispatcher — guarantees no `/api/*` path can 404 |

Every explicit route file (e.g. `src/app/api/overview/route.ts`) is a thin
26-line wrapper that calls `dispatchCatena(request, "/overview")` — pinning
the forced path so the underlying `MiniRouter` handler is resolved
deterministically regardless of any framework rewrite behavior.

---

## Frontend surfaces

### Landing page (`/`)

A statically-optimized (`force-static`) React server component
(`src/app/page.tsx`) rendering a cinematic marketing experience:

- Full-bleed looping background video with a scroll-cinematic reveal section
- A responsive header with desktop and mobile nav variants, a hamburger
  menu, and an "Enter Your Twin" call-to-action linking to `/dashboard`
- An orbit-image scroll-reveal built both as a compiled vanilla-JS bundle
  (`public/static/reveal/`) and as an equivalent React component
  (`src/components/reveal/RevealStage.tsx`) for embedding directly in JSX
- Global styling from `public/static/styles.css` / `style.css`, loaded via
  `<link>` tags in the page itself (kept outside the Tailwind pipeline
  intentionally, since this is a hand-tuned marketing surface)

### Dashboard (`/dashboard`)

A `force-dynamic` Next.js page that renders a minimal shell (`#dash-shell`,
`#dash-rail`, `#dash-topbar`, `#dash-main`, `#dash-tabbar`) and then boots a
**vanilla-JS single-page application** (`public/static/dash/app.js` and
friends) that:

1. Reads `<meta name="catena-api-base" content="/api">` to know its API base.
2. Fetches each panel's data from `/api/<endpoint>`, using `core.js`'s
   caching fetch wrapper.
3. Renders charts with a **dependency-free canvas/SVG chart engine**
   (`charts.js`) — no chart library is bundled.
4. Displays a **provenance strip** per panel showing which upstreams were
   live vs. degraded, sourced directly from the API's `Envelope.provenance`.
5. Falls back to `local-engine.js` — a deterministic in-browser model — if
   the API is completely unreachable (e.g. offline demo mode), so the
   dashboard is still explorable without any server at all.
6. Supports light/dark theming resolved synchronously before first paint via
   an inline boot script in `dashboard/page.tsx`, preventing a flash of
   unstyled/invisible content.

Panels are grouped into five view modules by domain:
`views-core.js` (Overview, Ingestion, SaaS), `views-domain.js` (Environment,
Medications, Nutrition, Clinician Brief), `views-reason.js` (Causal Graph,
Swarm, Cascade, Counterfactual), `views-privacy.js` (ZK/Privacy, Public
Health, Memory), and `views-voice.js` (Healthcare AI Assistant).

### Healthcare AI Assistant (dashboard view: `#assistant`)

A **browser-native, voice-to-voice** health companion that lives as its own
dashboard section (second item in the rail, `views-voice.js`). The entire
audio pipeline runs client-side; only the transcribed text touches the server.

**Pipeline**

1. **Speech-to-Text (input)** — the browser-native **Web Speech API**
   (`SpeechRecognition` / `webkitSpeechRecognition`) continuously transcribes
   the user's spoken audio and finalizes the transcript on speech end.
2. **Reasoning** — the transcript is POSTed to the same-origin
   `/api/assistant` route, which proxies to **Groq Cloud** using
   **`qwen/qwen3.6-27b`** (`temperature 0.6`, `top_p 0.95`,
   `reasoning_effort "default"`). A short system prompt enforces a
   **healthcare-only scope**, a warm tone, and short crisp answers, and appends
   a lightweight medical disclaimer. The `GROQ_API_KEY` is read server-side
   only and never exposed to the browser.
3. **Text-to-Speech (output)** — the reply is spoken back with the
   browser-native **`window.speechSynthesis`** API.

**Animated visualizers** — an orb + status line reflect the state machine
(`idle → Listening… → Thinking… → Speaking…`), so the user always knows what
the assistant is doing.

**Token frugality (Groq free tier)** — requests and responses are kept
minimal: the system prompt is compact, only the **last ~3 exchanges** are
forwarded as memory (each turn trimmed), `max_completion_tokens` is capped at
**220**, and the model is instructed to answer in at most 3 short sentences.
`<think>…</think>` reasoning spans are stripped before display/speech.

**Scope guard & safety** — non-medical questions (coding, weather, trivia,
etc.) are politely declined and redirected to health topics; every medical
answer ends with *"general info, not a substitute for professional medical
advice."* A typed-input fallback keeps the feature usable in browsers without
Web Speech support and for accessibility.

---

## External data sources & graceful degradation

Vaidyam is designed to be **fully functional with zero configuration** — no
API keys, no database — while transparently upgrading fidelity as
credentials become available. `src/lib/vaidyam/sources.ts` centralizes every
outbound call through a `safeJson()` helper that:

- Applies a request timeout (default 6.5s) via `AbortController`
- Records a `Provenance` entry (`{ source, live, fetchedAt, detail }`)
  whether the call succeeds, fails, or times out
- Never throws — a failed call resolves to `null` and the caller falls back
  to a deterministic, seeded synthetic value

**Live, keyless, CORS-open upstreams used out of the box:**

| Source | Used for | Requires a key? |
|--------|----------|------------------|
| Open-Meteo (`api.open-meteo.com`) | Weather | No |
| Open-Meteo Air Quality (`air-quality-api.open-meteo.com`) | PM2.5 / AQI | No |
| openFDA (`api.fda.gov`) | Drug adverse-event signals | No |
| Europe PMC (`www.ebi.ac.uk`) | Literature / PubMed mirror | No |
| disease.sh | Population/public-health stats | No |

**Optional, higher-fidelity upstreams:**

| Source | Used for | Env var |
|--------|----------|---------|
| USDA FoodData Central | Nutrition lookups | `USDA_API_KEY` |
| GroqCloud LPU | Fast LLM drafts for the swarm/cascade | `GROQ_API_KEY` |
| NVIDIA NIM | LLM verification of divergent spans | `NVIDIA_NIM_API_KEY` |
| OpenRouter | Agent-Forest voting pool (has `:free` models) | `OPENROUTER_API_KEY` |
| Generic OpenAI-compatible proxy | Fallback LLM provider | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |
| Supabase | Alternate persistence via REST | `SUPABASE_URL` + `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_KEY` |

---

## Multi-agent inference (LLM swarm & cascade)

`src/lib/vaidyam/inference.ts` implements two related mechanisms:

### 1. Draft/Verify Speculative Cascade

Modeled after speculative-decoding techniques (EAGLE/Medusa-style drafting,
paired with a larger verifier model):

1. A **fast draft model** (e.g. Groq's `llama-3.1-8b-instant`) answers first.
2. `routeQuery()` — a **FrugalGPT-style router** — inspects the query text
   and the draft's confidence to decide whether to escalate:
   - High-stakes keyword detection (e.g. "chest pain", "shortness of
     breath", "suicide", "bleed", "stroke", "emergency", "should I", "risk")
     always forces escalation regardless of confidence.
   - Otherwise, escalation is confidence-gated (`draftConfidence < 0.82` →
     verify; `< 0.7` → full swarm vote).
3. If escalated, a **larger verifier model** re-checks divergent spans, and
   for the highest-stakes queries a **swarm vote** (5–15 agents) is run.

### 2. Multi-Agent Swarm (Mixture-of-Agents)

Six domain-specialist agents (`AGENT_DEFS`) each reason within their
domain, seeded from specific graph nodes:

| Agent | Domain | Seeds |
|-------|--------|-------|
| Medication Agent | medication | `med-adherence`, `med-refill` |
| Sleep / Circadian Agent | sleep | `sleep-duration`, `sleep-deep` |
| Environmental Exposure Agent | environment | `env-pm25`, `env-pollen` |
| Mental Health Sentiment Agent | mental | `mental-mood`, `mental-stress` |
| Nutrition Agent | nutrition | `nutr-sodium`, `nutr-hydration` |
| Preventive-Care Coordinator | synthesis | (arbitrates the above) |

**Provider resolution order** (first configured key wins, per call):
`groq → nim → openrouter → proxy`. If **none** of the four providers has a
configured key, the swarm and cascade both fall back to a **fully
deterministic graph reasoner** that walks the personal causal graph itself —
every panel still renders real, internally-consistent numbers, and the
dashboard's live-status chip honestly reports "degraded" / "deterministic
graph reasoner (no provider key)".

---

## Counterfactual simulation engine

`src/lib/vaidyam/counterfactual.ts` implements an LLM-native approximation of
**do-calculus intervention**: `do(X = x)` severs incoming edges into node
`X`, then downstream effects are recomputed by propagating the change along
the causal graph's own *measured* edge strengths and lags (rather than
by re-running a black-box model).

- `buildLevers(vitals)` derives a set of adjustable levers (e.g. sleep
  hours, sodium intake, PM2.5 exposure, medication adherence) with realistic
  min/max/step bounds computed from the twin's own recent 14-day averages.
- `simulate(...)` applies a chosen lever delta and returns projected
  `Outcome[]` — each with a baseline value, projected value, delta,
  direction (`better`/`worse`/`flat`), the causal **path** it traveled
  through the graph, and a horizon in months.
- `literatureTerms(...)` maps simulated outcomes to literature search terms
  so the dashboard's Literature panel can surface supporting Europe PMC
  results for a given "what-if" scenario.

---

## Privacy layer — ZK attestations & differential privacy

`src/lib/vaidyam/privacy.ts` implements two complementary privacy
mechanisms, both computed **entirely server-side from data already scoped to
the twin** (no third-party ZK toolchain is invoked — the "circuit" and
"proof" fields describe the *shape* of a real EZKL/RISC-Zero-style
public-output-plus-proof system, populated with a deterministic
cryptographic-style digest via `sha256()` in `rand.ts`):

- **Claims** (`CLAIM_DEFS`) are declarative: each has an `id`, a
  human-readable `claim` (e.g. `adherence_ge_90_over_90d`), a `circuit`
  name, and a `compute(vitals)` function returning
  `{ value, threshold, satisfied, unit, statement, hidden[] }`. The `hidden`
  list documents exactly which raw fields (e.g. "per-dose timestamps", "drug
  identities", "pharmacy") never leave the twin — only the pass/fail
  `publicOutput` and a `proofDigest` are exposed.
- **Attestations** returned by `POST /api/zk/prove` bundle `proveMs`,
  `verifyMs`, `proofSizeBytes`, `commitment`, `witnessFieldsHidden`,
  `issuedAt`/`expiresAt`, and a `verifierUrl` so a third party could
  independently re-verify the claim via `GET /api/zk/verify`.
- **Differential privacy**: `dpAggregate()` applies Opacus-style
  Gaussian/Laplace noise to per-user contributions before they are combined
  into a population-level statistic, matching the shape of a Flower-style
  federated aggregation job — surfaced in the **Public Health** dashboard
  panel.
- **Memory/quantization accounting**: `quantizationStats()` reports the
  twin's modeled on-device storage footprint under different
  quantization/compression strategies, surfaced in the **Memory** panel.

---

## Determinism & reproducibility

Every synthetic value anywhere in the fallback paths is derived from a
**stable seed** — never `Math.random()`. `src/lib/vaidyam/rand.ts` provides:

- `fnv1a(string)` — a fast, dependency-free string hash
- `mulberry32(seed)` — a small, fast, high-quality PRNG
- `seeded(...parts)` — combines any number of parts (user id, day, metric
  name) into a single deterministic RNG stream
- `sha256(...)` — a lightweight digest used for commitments/proof hashes

This means the **same user id + the same day always produces the same
30-day vitals series, the same causal graph, and the same attestation
digests** — across requests, across server restarts, and across the
client/server boundary (the browser's `local-engine.js` fallback uses the
same algorithm so offline mode matches server mode exactly).

---

## Getting started locally

### Prerequisites

- Node.js 18+ (Next.js 16 / React 19)
- A reachable PostgreSQL instance (local Docker/Postgres, or Supabase)
  — optional, but recommended for full persistence

### Install & run

```bash
npm install
npx drizzle-kit push     # applies src/db/schema.ts to your database
npm run dev              # http://localhost:3000
```

Open:
- `http://localhost:3000` — landing page
- `http://localhost:3000/dashboard` — live twin dashboard

The app works immediately with **no environment variables set** — every
panel renders using live, keyless upstreams plus deterministic fallbacks.

---

## Environment variables

Copy `.env.example` to `.env` (or `.dev.vars.example` to `.dev.vars` for a
Cloudflare-Workers-style local dev flow) and fill in only what you need.
**Every variable is optional except `DATABASE_URL`**, and even that has a
graceful in-memory fallback.

| Variable | Required | Effect when present | Effect when absent |
|----------|----------|----------------------|----------------------|
| `DATABASE_URL` | Recommended | Persists twins/observations/attestations/simulations to Postgres | Twin is computed per-request from live data + a stable seed; nothing throws |
| `USDA_API_KEY` | Optional | Real USDA FoodData Central nutrition lookups | Deterministic per-food nutrition estimator (labelled non-live) |
| `GROQ_API_KEY` | Optional | Fast LLM drafts for swarm/cascade | Falls to next provider, then to the deterministic graph reasoner |
| `NVIDIA_NIM_API_KEY` | Optional | LLM verification stage | Falls to next provider |
| `OPENROUTER_API_KEY` | Optional | Free-tier model voting pool | Falls to next provider |
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` | Optional | Generic OpenAI-compatible proxy provider | Falls to deterministic reasoner |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_KEY` | Optional | Alternate REST-based persistence | Ignored; Drizzle/Postgres path (or in-memory) used instead |

> ⚠️ Do not use the literal string `DEMO_KEY` for `USDA_API_KEY` — it is
> globally rate-limited (HTTP 429) and is explicitly treated the same as "no
> key" by `sources.ts`.

---

## Database setup

The project uses **Drizzle ORM** with a schema-push workflow (no migration
files) against PostgreSQL:

```bash
# 1. Point DATABASE_URL at your Postgres instance (.env)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# 2. Push the schema
npx drizzle-kit push
```

`drizzle.config.json` points at `./src/db/schema.ts` as the single source of
truth. If you'd rather use Supabase's hosted Postgres, either:

- Point `DATABASE_URL` at Supabase's connection string (session pooler,
  port `5432` or `6543`) and run `drizzle-kit push` as above, **or**
- Apply `supabase/schema.sql` directly via `psql` and use the
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` REST path instead
  (`src/lib/vaidyam/supabase.ts`).

---

## Available scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `next dev` | Local development server with hot reload |
| `build` | `next build` | Production build (Turbopack) |
| `start` | `next start` | Run the production build |
| `lint` | `eslint .` | Lint with `eslint-config-next/core-web-vitals` |
| `typecheck` | `tsc --noEmit` | Strict TypeScript type checking |

Additional standalone Node scripts (not wired into `package.json`, run
directly with `node`):

| Script | Purpose |
|--------|---------|
| `scripts/verify.mjs` | End-to-end smoke test — hits every `/api/*` endpoint and checks required static assets exist. Run `node scripts/verify.mjs --no-api` for a static-only check, or `BASE=http://127.0.0.1:3000 node scripts/verify.mjs` against a running server. |
| `scripts/build-reveal.mjs` | Rebuilds the compiled `public/static/reveal/*` bundle from `src/reveal/*` (only needed if you edit the reveal animation source) |
| `scripts/build-local-engine.mjs` | Rebuilds `public/static/dash/local-engine.js` from `src/local/engine.ts` |

---

## Validation & testing

Before shipping any change, run the full validation sequence:

```bash
npx next typegen              # generates route types for the App Router
npx tsc --noEmit               # strict type checking, zero emit
npm run build                  # production build must succeed
node scripts/verify.mjs --no-api   # static-artifact checks
BASE=http://127.0.0.1:3000 node scripts/verify.mjs  # full API smoke test (server must be running)
```

All four pass cleanly on this codebase as configured, including a
production `next build` that emits 21 dynamic API routes plus the static
landing page and the dynamic dashboard shell.

---

## Deployment

### Vercel (recommended, free tier)

Required project settings (already encoded in `vercel.json`):

1. **Framework Preset:** `Next.js`
2. **Build Command:** `next build`
3. **Output Directory:** leave empty / override OFF — do **not** set `.next`,
   `dist`, `dist-static`, or `out`
4. **Install Command:** `npm install`
5. **Root Directory:** repository root

Set environment variables under Project → Settings → Environment Variables
(same names as `.env.example`). After deploying, verify:

- `GET https://<app>.vercel.app/api/health` → `{ "ok": true, "app": "catena", "host": "nextjs", ... }`
- `GET https://<app>.vercel.app/api/overview` → an envelope with `data.kpis`
- `/dashboard` loads live panels

### Database for production

- **Local/self-hosted Postgres**, or
- **Supabase free tier** — use the *session pooler* connection string as
  `DATABASE_URL`

### Any other Node.js host

Because this is a standard Next.js App Router project with no edge-only
APIs used for the database layer, it can also be deployed to any platform
that supports `next build` + `next start` (Render, Railway, Fly.io, a plain
VM, etc.).

---

## Tech stack summary

| Layer | Technology |
|-------|-------------|
| Framework | Next.js 16 (App Router, Turbopack builds) |
| UI runtime | React 19 / ReactDOM 19 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/postcss`) for app chrome; hand-authored CSS for the landing page and dashboard |
| Animation | `motion` (Framer Motion successor) for the React reveal component |
| Database | PostgreSQL |
| ORM | Drizzle ORM (`drizzle-orm/node-postgres`) + Drizzle Kit for schema push |
| DB driver | `pg` (node-postgres), explicitly excluded from edge bundling |
| Language | TypeScript (strict mode) end-to-end |
| Linting | ESLint 9 flat config, `eslint-config-next` |
| AI providers | Groq, NVIDIA NIM, OpenRouter, generic OpenAI-compatible proxy (all optional) |
| External data | Open-Meteo, openFDA, Europe PMC, disease.sh, USDA FoodData Central |
| Hosting | Vercel (Node.js serverless functions) or any Node host |
| Dashboard client | Vanilla JavaScript (no framework/chart library) for the SPA panels — deliberately dependency-free for fast, small bundles |

---

## Design principles

1. **Never throw on missing configuration.** Every optional integration
   (database, LLM providers, Supabase, USDA) degrades to a clearly labelled,
   deterministic fallback rather than crashing a route.
2. **Provenance is a first-class API contract.** Every response documents
   which upstreams were actually live, so the UI never silently pretends
   fallback data is real.
3. **Determinism over randomness.** All synthetic data is seeded from stable
   identifiers so twins are reproducible, testable, and consistent between
   the server and the offline browser fallback.
4. **One deployable artifact.** No microservices, no separate API server, no
   edge-runtime/Node-runtime split for the database layer — this avoids the
   exact class of deployment bugs documented in `DIAGNOSIS.md`.
5. **Privacy by construction.** Raw physiological series never leave the
   twin; only claims, aggregates, and proofs do.

---

## Roadmap ideas

These are natural extensions if you want to keep building on this
foundation:

- Wire real wearable ingestion (Apple Health / Google Fit / Fitbit export)
  into `observations` in place of the synthetic 30-day generator.
- Add authentication (NextAuth/Clerk) so `external_uid` maps to a real
  logged-in user instead of a query-string/header identifier.
- Persist `graph_snapshots` and `simulations` on every request so the
  Counterfactual and Causal Graph panels show real historical trend lines.
  instead of being recomputed from scratch each time.
- Swap the hand-rolled ZK "shape" in `privacy.ts` for a real proving system
  (e.g. EZKL) if genuine cryptographic verifiability is required.
- Add integration tests around `scripts/verify.mjs` in CI (GitHub Actions)
  running against a Postgres service container.

---
