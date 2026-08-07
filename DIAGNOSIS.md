# Root-cause analysis

Three defects were reported. Each is traced to its actual mechanism below, not
to its symptom.

---

## 1. Mobile navbar "Download" button is misaligned

**Symptom** — on phones the white `Download` pill sits visually low / crowded
against the pills to its left, and its icon+label do not read as vertically
centred.

**Mechanism** — three compounding causes in `public/static/styles.css`:

1. **The flex row has no common baseline.** `#main-header` is `height: 80px` with
   `align-items: center`, and `.mobile-header` is `height: 100%`. But
   `.mobile-left` is declared `height: 36px` while `.download-btn-m` is also
   `36px` — *inside a 100%-height (80px) flex line*. Because
   `.mobile-header`'s `align-items: center` is inherited from the shorthand and
   `.mobile-left` carries `position: relative` + `flex-grow: 1`, the two
   children resolve their cross-axis position independently. Any sub-pixel
   rounding of the 80px line box lands the two 36px boxes on different rows.

2. **`margin-right: 16px` on `.mobile-left` fights `gap: 8px` on
   `.mobile-header`.** The container gap and the child margin both apply, so the
   real gutter is 24px, and it is asymmetric: the pill's optical right inset
   (16px viewport padding) no longer matches its left gutter. This is what reads
   as "misaligned" rather than "mis-sized".

3. **`.menu-pill-m.open { width: 100% }` overflows the line.** When the burger
   menu is open the nav pill grows to 100% of `.mobile-left`, which is
   `flex-grow: 1`. `.download-btn-m` is `flex-shrink: 0`, so the line overflows
   the 16px-padded header instead of the nav pill yielding — pushing the
   Download pill partly off the right edge on narrow phones.

Additionally `.download-btn-m i { transform: translateY(-0.5px) }` applies a
half-pixel nudge to the Bootstrap-icon glyph. Bootstrap Icons are already
baseline-aligned via `line-height: 1`; on a device pixel ratio of 2 or 3 that
half pixel rounds inconsistently, so the apple glyph and the word "Download"
sit on visibly different baselines.

**Fix** — give the mobile line a single explicit `36px` row with
`align-items: center` on every participant, remove the double gutter, let the
nav pill shrink instead of the CTA, and drop the sub-pixel glyph nudge in favour
of real flex centring. Plus a `<=380px` tier that keeps only the icon.

---

## 2. The Mux HLS stream is still requested by the reveal section

**Symptom** — `https://stream.mux.com/OD2Ny…m3u8` is still fetched even though
`src/reveal/App.tsx` no longer contains a `<video>` element.

**Mechanism** — **the compiled bundle was committed to git and never rebuilt.**

* `public/static/reveal/reveal.js` is a *build output* of
  `src/reveal/main.tsx`, produced by `scripts/build-reveal.mjs`.
* It was tracked in git. `.gitignore` ignored `dist/` and `dist-static/` but
  **not** `public/static/reveal/`.
* `src/reveal/App.tsx` had already been cleaned (no `<video>`, no hls.js, no
  `Shamoni©` wordmark). The committed bundle predated that edit and still
  contained both the manifest URL and the
  `cdn.jsdelivr.net/npm/hls.js@1.5.17` loader:

  ```
  Gd=`https://stream.mux.com/OD2Ny…m3u8`,
  Kd=`https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js`
  ```

* `public/index.html` still shipped `<link rel="preconnect"
  href="https://stream.mux.com">`, so the browser opened a TCP+TLS connection to
  Mux on *every* page load regardless of the bundle.
* **`vercel.json` guaranteed the stale bundle would survive**:
  `"buildCommand": "node scripts/build-static.mjs"` — that script only copies
  `public/` into `dist-static/`. It never runs `build:reveal`. So the deployed
  artifact was always the committed (stale) bundle, and no amount of editing
  `App.tsx` could change the deployed output.

**Fix** — untrack the bundle and ignore it, delete the Mux preconnect, point
`vercel.json` at the composite build, and add the pure-CSS
`.reveal-backdrop` motion graphic that replaces the video in the same box and
z-index. The sections above (`#hero-section`, `#cinematic-section`,
`#stats-section`) and below (`#main-footer`) are untouched.

---

## 3. Dashboard shows `HTTP 404 on /overview`

**Symptom** — every dashboard panel renders `Could not load live data. HTTP 404
on /overview`, and the live chip reads `upstream error`.

**Mechanism** — **the dashboard assumes a server that the deployed artifact does
not contain.**

* `public/static/dash/core.js` builds its request URL as a hard-coded
  same-origin relative path:

  ```js
  var url = "/api" + path + "?" + qs(params);
  ```

* `/api/*` is served by the **Hono worker** in `src/api/index.ts`. That worker
  only exists in the *Cloudflare Pages* build (`npm run build` → `dist/` with
  `_worker.js`).
* The project's configured deployment target is **Vercel static**:
  `vercel.json` sets `outputDirectory: "dist-static"` and
  `buildCommand: "node scripts/build-static.mjs"`, which produces **only**
  `index.html`, `dashboard.html`, `robots.txt` and `static/**`. There is no
  serverless function, no `/api` route, nothing that can answer `/api/overview`.
* Therefore `/api/overview` resolves against the static host, misses every
  file, and returns **404** — which `core.js` surfaces verbatim as
  `HTTP 404 on /overview`.
* The failure is *total* rather than partial: `C.api()` rejects, `C.load()`'s
  `.catch` replaces the whole view with `C.errBox`, so no panel renders. There
  is no per-panel degradation and no offline path.

**Secondary contributing factors**

* `C.api()` has no notion of a configurable API origin, so a working worker
  deployed at a *different* host could not be pointed at.
* `providers()` and `supabaseConfigured(env)` dereference `env` directly; with
  `c.env` absent (`undefined`) `supabaseConfigured` throws, so even a partially
  wired runtime would 500 rather than degrade.
* `USDA_API_KEY` falls back to the literal `DEMO_KEY`, which now returns
  **HTTP 429** (verified) — so the nutrition panel was never live even when the
  worker *was* reachable.

**Fix (two layers)**

1. **Host-agnostic API resolution.** `core.js` probes an ordered list of
   candidate bases (`?api=` override → `<meta name="catena-api-base">` →
   `window.CATENA_API_BASE` → `localStorage` → same-origin `/api`) against
   `/health` with a short timeout, and remembers the winner.
2. **In-browser local engine.** When no base answers, the dashboard runs the
   **real Hono API in the browser**. `src/local/engine.ts` imports the exact same
   `src/api/index.ts` app and serves it through `app.fetch()`; Hono is
   runtime-agnostic, so the response envelopes are byte-identical to the edge
   worker's. No logic is duplicated.

   This is viable because every free upstream the API uses is CORS-open —
   verified with live requests:

   | Upstream | `access-control-allow-origin` | Status |
   |---|---|---|
   | `api.open-meteo.com` | `*` | 200 |
   | `air-quality-api.open-meteo.com` | `*` | 200 |
   | `disease.sh` | `*` | 200 |
   | `api.fda.gov` | `*` | 200 |
   | `www.ebi.ac.uk` (Europe PMC) | `*` | 200 |
   | `geocoding-api.open-meteo.com` | `*` | 200 |
   | `eutils.ncbi.nlm.nih.gov` (PubMed) | *absent* | 302 → blocked in browser |
   | `api.nal.usda.gov` + `DEMO_KEY` | `*` | **429** |

   PubMed is unreachable from a browser, which is exactly why the API already
   falls back to Europe PMC — that path now carries the citation load in local
   mode. USDA needs a real key; without one the nutrition panel uses the
   deterministic estimator and is labelled non-live in the provenance strip.
