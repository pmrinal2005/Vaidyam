# SynapseX — Neural-AI Interface Landing Page

## Project Overview
- **Name**: SynapseX
- **Goal**: A cinematic, scroll-driven landing page for a fictional neural-AI interface product.
- **Features**:
  - Fixed background video **scrubbed by scroll position** (blur + zoom ramp tied to scroll progress)
  - Cinematic entrance: video zoom-out, then header/content fade-in
  - **Scramble-in / scramble-out** hero typography (reverses when you scroll away, replays at top)
  - 3D perspective parallax statement paragraph with keyframed opacity
  - Coverflow **metrics carousel** (Swiper 11, looped, grab-cursor)
  - Expanding glass pills for logo + hamburger nav (separate desktop and mobile variants)
  - Lenis smooth scrolling on desktop, native scrolling on mobile
  - Progressive bottom blur/vignette overlay
  - Accessibility: skip link, semantic landmarks, `aria-expanded` menus, Esc closes menus, focus-visible rings, `prefers-reduced-motion` static fallback
  - Graceful degradation: page stays usable if the video, Swiper CDN or Lenis CDN fails

## Structure
```
webapp/
├── public/                    # ← the entire site (static, no server needed)
│   ├── index.html             # semantic markup, shared SVG symbol for the logo
│   └── static/
│       ├── styles.css         # all styles
│       └── app.js             # all behaviour (IIFE, no build step, no deps)
├── scripts/
│   ├── build-static.mjs       # public/ → dist-static/ (+ robots.txt)  ← Vercel build
│   └── serve-static.mjs       # zero-dep server used to verify dist-static locally
├── src/index.tsx              # optional Hono worker (Cloudflare Pages preview + /api/health)
├── vercel.json                # Vercel free-tier static config
├── ecosystem.config.cjs       # PM2: serves dist-static on :3000
├── vite.config.ts             # Cloudflare Pages worker build
└── wrangler.jsonc             # Cloudflare Pages config
```

## Functional entry URIs
| Path | Description |
|------|-------------|
| `/` | The landing page (only page) |
| `/static/styles.css` | Stylesheet |
| `/static/app.js` | Behaviour script |
| `/robots.txt` | Generated at build time |
| `#hero-section` / `#cinematic-section` / `#stats-section` | In-page nav anchors (Logo / About / Metrics) |
| `/api/health` | JSON health check — **Cloudflare Pages deploy only**, not present on Vercel static |

## Data Architecture
- **Data models**: a single in-file `statsData` array (`title`, `value`, `footer`, `details[]`) rendered into carousel cards at runtime.
- **Storage services**: none — the site is fully static; no database, no persistence, no API keys.
- **Data flow**: scroll position → normalized progress → smoothed (lerp) → drives `video.currentTime`, CSS `filter`/`transform`/`opacity` inside one `requestAnimationFrame` loop.
- **External assets**: Google Fonts (Space Mono), Bootstrap Icons, Swiper 11, Lenis 1.1.18 — all via CDN; background MP4 served from CloudFront.

## User Guide
1. Open the page and wait ~1.4 s for the entrance animation.
2. The hero words assemble letter-by-letter from random glyphs.
3. Scroll down: the hero words scramble away, the video blurs and zooms, the statement paragraph tilts through view, then the metrics cards slide in.
4. Drag / swipe the metrics carousel, or use its arrow keys after focusing it.
5. Use the hamburger pill for **About** / **Metrics** jumps; click the logo pill (or press Esc then the logo) to return to the top.
6. **Download** opens the linked external profile in a new tab.

## Deployment

### Vercel (free tier — recommended, this is what the config targets)
The site ships **zero serverless functions**, so it fits the Hobby plan with no limits risk.

- **Option A — dashboard**: Import the repo. Vercel reads `vercel.json`:
  - Framework Preset: *Other* (`"framework": null`)
  - Build Command: `node scripts/build-static.mjs`
  - Output Directory: `dist-static`
  - Install Command: `npm install --no-audit --no-fund`
- **Option B — CLI**:
  ```bash
  npm i -g vercel
  cd webapp
  vercel        # preview
  vercel --prod # production
  ```
- **Option C — no build at all**: `vercel deploy public --prod` (uploads `public/` directly).

`vercel.json` also sets `cleanUrls`, an index.html rewrite for unknown paths, static caching for `/static/*`, and `nosniff` / `Referrer-Policy` / `X-Frame-Options` headers.

### Cloudflare Pages (kept working, optional)
```bash
npm run build                  # builds dist/ (static assets + _worker.js)
npx wrangler pages deploy dist
```

### Local verification (sandbox)
```bash
npm run build:static           # public/ -> dist-static/
pm2 start ecosystem.config.cjs # serves dist-static on http://localhost:3000
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
pm2 logs --nostream
```

## Not yet implemented
- No CMS/back end — the metrics are hard-coded, not live telemetry
- No real download/App Store link (points to an external profile)
- No additional routes (About / Metrics are in-page anchors only)
- No automated tests, no analytics, no favicon/OG image asset
- No i18n

## Recommended next steps
1. Add a favicon + OG share image and self-host the fonts to remove CDN dependence.
2. Serve a compressed/poster-framed video (or a WebM variant) and lazy-swap a lighter clip on mobile.
3. Replace hard-coded metrics with a JSON file (or an edge function on Cloudflare) so copy edits need no code change.
4. Add Lighthouse CI + a smoke test in GitHub Actions.
5. Consider a `<canvas>`-based frame-sequence scrubber if precise video seeking proves janky on Safari.

## Tech Stack
Vanilla HTML + CSS + JS (no framework) · Swiper 11 · Lenis · Hono (optional CF worker) · Vite · Wrangler · PM2

- **Status**: ✅ Active locally, deploy-ready
- **Last Updated**: 2026-08-05
