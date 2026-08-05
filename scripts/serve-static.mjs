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

function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  let candidate = join(root, clean)
  if (!candidate.startsWith(root)) candidate = root
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, 'index.html')
  if (!existsSync(candidate) && existsSync(candidate + '.html')) candidate += '.html'
  if (!existsSync(candidate)) candidate = join(root, 'index.html') // SPA fallback
  return candidate
}

createServer((req, res) => {
  const file = resolvePath(req.url || '/')
  const type = MIME[extname(file)] || 'application/octet-stream'
  res.writeHead(existsSync(file) ? 200 : 404, {
    'Content-Type': type,
    'Cache-Control': file.includes(`${'static'}`) ? 'public, max-age=3600' : 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })
  createReadStream(file).pipe(res)
}).listen(port, host, () => {
  console.log(`[serve-static] http://${host}:${port} → ${root}`)
})
