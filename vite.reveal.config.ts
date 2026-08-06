import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Builds the React + motion "opening reveal" island.
 *
 * Output goes to `.reveal-build/` (outside `public/`, otherwise Vite's
 * publicDir copy step recurses) and `scripts/build-reveal.mjs` syncs the
 * emitted bundle into `public/static/reveal/`. From there the pre-existing
 * 100% static pipeline (scripts/build-static.mjs) and Cloudflare Pages pick
 * it up unchanged.
 *
 * Kept separate from vite.config.ts so the Hono/Cloudflare worker build is
 * completely untouched.
 *
 * JSX NOTE: the root tsconfig.json pins `jsxImportSource: "hono/jsx"` for the
 * worker entry. `esbuild.jsxImportSource` below forces React's runtime for
 * this build regardless of which tsconfig esbuild happens to resolve, so the
 * island can never be compiled against Hono's JSX factory again.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react'
  },
  build: {
    outDir: '.reveal-build',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: 'src/reveal/main.tsx',
      output: {
        entryFileNames: 'reveal.js',
        chunkFileNames: 'reveal-[name].js',
        assetFileNames: 'reveal.[ext]'
      }
    }
  }
})
