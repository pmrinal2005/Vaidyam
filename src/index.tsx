import { Hono } from 'hono'

/**
 * SynapseX — edge entry point.
 *
 * The site itself is 100% static (public/index.html + /static/*), so it can be
 * hosted anywhere (Vercel free tier, Cloudflare Pages, any CDN) with no server
 * runtime. This worker only exists for the Cloudflare Pages preview and adds a
 * tiny health endpoint; static assets are served by the platform and take
 * precedence over this handler.
 */
const app = new Hono()

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    app: 'synapsex',
    runtime: 'cloudflare-pages',
    time: new Date().toISOString()
  })
)

// Anything not matched by a static asset falls back to the landing page.
app.all('*', async (c) => {
  const url = new URL(c.req.url)
  if (url.pathname !== '/') {
    return c.redirect('/', 302)
  }
  return c.text('SynapseX static assets not found. Run `npm run build` first.', 404)
})

export default app
