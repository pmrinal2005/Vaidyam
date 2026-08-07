import { defineConfig } from 'vite'

/**
 * Builds the CATENA LOCAL ENGINE browser bundle.
 *
 * WHY THIS CONFIG EXISTS  (root cause of "HTTP 404 on /overview")
 * --------------------------------------------------------------
 * `src/local/engine.ts` imports the *real* Hono app from `src/api/index.ts` and
 * exposes it as `window.Catena.localEngine`. `public/static/dash/core.js`
 * already probes for that object as its last-resort transport:
 *
 *     if (C.localEngine) { C.apiBase = "local"; … }
 *
 * …but nothing ever compiled `src/local/engine.ts` into something a browser
 * could load, and `dashboard.html` never referenced it. So `C.localEngine` was
 * permanently `undefined` on the deployed static artifact:
 *
 *   1. `C.resolveApi()` probed `<origin>/api/health` → the static host has no
 *      worker → miss;
 *   2. with `C.localEngine` undefined it resolved to `null`;
 *   3. `C.api()` then threw, `C.load()`'s `.catch` replaced the entire view with
 *      `C.errBox`, and every panel read "Could not load live data."
 *
 * This config closes that last gap: it emits
 * `public/static/dash/local-engine.js`, which `dashboard.html` loads *before*
 * `core.js`, so the fallback transport genuinely exists at runtime.
 *
 * FORMAT: `iife`, deliberately.
 * -----------------------------
 * `core.js` and friends are classic `defer` scripts. Classic-deferred and
 * `type="module"` scripts share one execution queue in document order, so a
 * module would *usually* work — but an IIFE removes all ambiguity: a classic
 * `defer` script placed first is guaranteed to have assigned
 * `window.Catena.localEngine` before `core.js` runs, on every engine, including
 * ones where a module's extra fetch/parse cost changes ordering under a slow
 * network. It also means the file works if a host serves it with a
 * non-module-friendly MIME type.
 *
 * Kept as its own config (not merged into vite.config.ts) so the
 * Hono/Cloudflare **worker** build stays byte-for-byte untouched — the worker
 * and this bundle compile the same `src/api/index.ts` from two entry points and
 * must never influence each other's output.
 */
export default defineConfig({
  // `public/` is the static root of the host site; letting Vite treat it as a
  // publicDir here would recurse the copy step (same guard as the reveal build).
  publicDir: false,
  define: {
    // `src/api/**` and `src/lib/**` are runtime-agnostic, but bundlers still
    // inline `process.env.NODE_ENV` guards from transitive deps. Pin it so no
    // `process` reference can reach the browser.
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: '.local-engine-build',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    minify: 'esbuild',
    cssCodeSplit: false,
    lib: {
      entry: 'src/local/engine.ts',
      name: 'CatenaLocalEngine',
      formats: ['iife'],
      fileName: () => 'local-engine.js'
    },
    rollupOptions: {
      // Nothing is external: the whole point is a self-contained transport that
      // works with zero server and zero CDN dependency.
      external: [],
      output: {
        // Keeps the global assignment in engine.ts authoritative and avoids
        // leaking a second global name onto `window`.
        extend: true
      }
    }
  }
})
