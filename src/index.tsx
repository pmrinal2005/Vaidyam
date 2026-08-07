import { Hono } from 'hono'
import api from './api/index'
import type { Bindings } from './lib/types'

/**
 * Catena / SynapseX — edge entry point.
 *
 * The marketing site stays 100% static (public/index.html + /static/*). This
 * worker mounts the Catena edge API under /api/* and serves the two HTML
 * documents through the Pages static-asset binding so both the landing page (/)
 * and the dashboard (/dashboard) resolve as clean URLs.
 */
type Env = Bindings & { ASSETS?: { fetch: (req: Request) => Promise<Response> } }

const app = new Hono<{ Bindings: Env }>()

app.route('/api', api)

// Serves an asset by absolute path via the Pages asset binding.
async function asset(c: any, path: string): Promise<Response> {
  const binding = c.env?.ASSETS
  if (binding) {
    const url = new URL(c.req.url)
    url.pathname = path
    url.search = ''
    const res = await binding.fetch(new Request(url.toString(), { headers: c.req.raw.headers }))
    if (res.ok) return new Response(res.body, { status: 200, headers: res.headers })
  }
  return c.text('Static bundle not found. Run `npm run build` first.', 404)
}

// Clean dashboard URL (the landing CTAs point here).
app.get('/dashboard', (c) => asset(c, '/dashboard.html'))
app.get('/dashboard/', (c) => asset(c, '/dashboard.html'))

// Landing page.
app.get('/', (c) => asset(c, '/index.html'))

// Unknown paths fall back to the landing page rather than a bare 404.
app.all('*', async (c) => {
  const url = new URL(c.req.url)
  if (url.pathname.startsWith('/api/')) return c.json({ ok: false, error: 'Unknown API route' }, 404)
  if (c.env?.ASSETS) {
    const direct = await c.env.ASSETS.fetch(c.req.raw)
    if (direct.ok) return direct
  }
  return c.redirect('/', 302)
})

export default app
