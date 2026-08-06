import { Hono } from 'hono'
import api from './api/index'
import type { Bindings } from './lib/types'

/**
 * Catena / SynapseX — edge entry point.
 *
 * The marketing site stays 100% static (public/index.html + /static/*). This
 * worker mounts the Catena edge API under /api/* and keeps a static-asset
 * fallback so the landing page and dashboard shell are always reachable.
 * Static assets are served by the platform and take precedence over these
 * handlers.
 */
const app = new Hono<{ Bindings: Bindings }>()

app.route('/api', api)

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    app: 'catena',
    runtime: 'cloudflare-pages',
    time: new Date().toISOString()
  })
)

// Static assets normally answer first; these only run if an asset is missing.
app.all('*', async (c) => {
  const url = new URL(c.req.url)
  if (url.pathname.startsWith('/dashboard')) {
    return c.redirect('/dashboard.html', 302)
  }
  if (url.pathname !== '/') {
    return c.redirect('/', 302)
  }
  return c.text('SynapseX static assets not found. Run `npm run build` first.', 404)
})

export default app
