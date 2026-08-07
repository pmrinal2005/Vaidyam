/**
 * serve-static.mjs
 * Zero-dependency static file server used to verify the exact bundle that gets
 * uploaded to Vercel (dist-static/). Mirrors vercel.json: SPA-style fallback to
 * index.html for unknown paths.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist-static')
const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
}

/**
 * Paths that must NEVER hit the SPA fallback — mirrors the negative-lookahead
 * rewrite in vercel.json.
 *
 *  • `/api/*`  — a static host has no worker. Rewriting it to index.html made
 *    the dashboard's `/api/health` probe answer 200 + HTML, so core.js had to
 *    parse HTML as JSON before rejecting it. A clean 404 is the fastest handoff
 *    to the in-browser local engine (public/static/dash/local-engine.js).
 *  • `/static/*` — a genuinely missing asset must 404, not silently return the
 *    landing page (which is how a stale/missing bundle hides itself).
 */
const NO_FALLBACK = /^\/(api|static)(\/|$)/

function resolvePath(urlPath) {
  const rawPath = urlPath.split('?')[0]
  const clean = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, '')
  let candidate = join(root, clean)
  if (!candidate.startsWith(root)) candidate = root
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, 'index.html')
  if (!existsSync(candidate) && existsSync(candidate + '.html')) candidate += '.html'
  if (!existsSync(candidate)) {
    if (NO_FALLBACK.test(rawPath)) return null // real 404
    candidate = join(root, 'index.html') // SPA fallback
  }
  return candidate
}

createServer((req, res) => {
  const file = resolvePath(req.url || '/')

  if (!file || !existsSync(file)) {
    const isApi = /^\/api(\/|$)/.test((req.url || '/').split('?')[0])
    const body = isApi
      ? JSON.stringify({
          ok: false,
          error: 'No API worker on this static host.',
          hint: 'Expected — the dashboard falls back to the in-browser local engine. Deploy the Cloudflare Pages build, or pass ?api=<worker-origin>/api, for the keyed edge API.'
        })
      : 'Not found'
    res.writeHead(404, {
      'Content-Type': isApi ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(body)
    return
  }

  const type = MIME[extname(file)] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': file.includes(`${'static'}`) ? 'public, max-age=3600' : 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })
  createReadStream(file).pipe(res)
}).listen(port, host, () => {
  console.log(`[serve-static] http://${host}:${port} → ${root}`)
})
