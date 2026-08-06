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
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
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
