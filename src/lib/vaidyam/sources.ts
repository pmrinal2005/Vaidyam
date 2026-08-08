/**
 * Free external data sources (Layer 0 ingestion).
 *
 * Every fetch is wrapped so a failing/rate-limited upstream degrades into a
 * deterministic synthetic value instead of breaking the dashboard. The
 * provenance array tells the UI exactly which panels are live.
 */
import type { Provenance } from './types'
import { seeded, gauss, clamp, round } from './rand'

const UA = 'Catena-Health-Twin/1.0 (research prototype; contact: catena@example.org)'

export async function safeJson<T>(
  url: string,
  label: string,
  prov: Provenance[],
  timeoutMs = 6500,
  init?: RequestInit
): Promise<T | null> {
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': UA, ...(init?.headers || {}) }
    })
    clearTimeout(timer)
    if (!res.ok) {
      prov.push({ source: label, live: false, fetchedAt: new Date().toISOString(), detail: `HTTP ${res.status}` })
      return null
    }
    const json = (await res.json()) as T
    prov.push({
      source: label,
      live: true,
      fetchedAt: new Date().toISOString(),
      detail: `${Date.now() - started}ms`
    })
    return json
  } catch (err: any) {
    prov.push({
      source: label,
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err).slice(0, 90)
    })
    return null
  }
}

/* ── Geolocation from edge request metadata (zero-cost, no API) ── */
export type GeoCtx = { lat: number; lon: number; city: string; region: string; country: string; live: boolean }

/** Decodes a possibly percent/UTF-8-encoded header city name (Vercel encodes them). */
function decodeHeaderText(v: string | null | undefined): string {
  if (!v) return ''
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/**
 * Resolves geo from whatever the host actually provides.
 *
 * HOST-AGNOSTIC BY DESIGN — this used to read ONLY `request.cf`, which exists
 * exclusively on Cloudflare. On every other runtime `cf` is `undefined`, so with
 * no explicit ?lat/?lon the function fell straight through to the hard-coded
 * New Delhi default. That made weather/air-quality panels *look* live (the
 * upstream really did answer 200) while describing a city the user was nowhere
 * near — a silent wrong-data bug, worse than a visible failure.
 *
 * Resolution order, most trustworthy first:
 *   1. explicit ?lat/?lon         — the browser Geolocation API, forwarded by
 *                                   core.js; the only source the user consented to
 *   2. `request.cf`               — Cloudflare Workers/Pages
 *   3. `x-vercel-ip-*` headers    — Vercel Edge/Node functions
 *   4. `x-nf-geo` (base64 JSON)   — Netlify
 *   5. generic CDN headers        — Fastly/Akamai/Cloudflare `cf-ipcity` etc.
 *   6. New Delhi default          — reported as `live: false` so the provenance
 *                                   strip labels it, and never silently trusted
 */
export function geoFromRequest(req: Request, fallback?: { lat?: number; lon?: number }): GeoCtx {
  const cf = (req as any).cf || {}
  const h = (name: string): string => {
    try {
      return decodeHeaderText(req.headers?.get?.(name)) || ''
    } catch {
      return ''
    }
  }

  // Netlify ships one base64 JSON blob rather than discrete headers.
  let nf: any = {}
  const nfRaw = h('x-nf-geo')
  if (nfRaw) {
    try {
      nf = JSON.parse(typeof atob === 'function' ? atob(nfRaw) : nfRaw)
    } catch {
      nf = {}
    }
  }

  const edgeLat = cf.latitude ?? h('x-vercel-ip-latitude') ?? nf?.latitude
  const edgeLon = cf.longitude ?? h('x-vercel-ip-longitude') ?? nf?.longitude
  const hasEdge = Number.isFinite(Number(edgeLat)) && Number.isFinite(Number(edgeLon))

  // An explicit client fix (Geolocation API) always wins over IP inference.
  const explicit = Number.isFinite(Number(fallback?.lat)) && Number.isFinite(Number(fallback?.lon))
  const lat = Number(explicit ? fallback!.lat : edgeLat)
  const lon = Number(explicit ? fallback!.lon : edgeLon)

  const city =
    String(cf.city || '') ||
    h('x-vercel-ip-city') ||
    String(nf?.city || '') ||
    h('cf-ipcity') ||
    (explicit ? 'Your location' : '')
  const region = String(cf.region || '') || h('x-vercel-ip-country-region') || String(nf?.subdivision?.name || '')
  const country =
    String(cf.country || '') || h('x-vercel-ip-country') || String(nf?.country?.code || '') || h('cf-ipcountry')

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return {
      lat,
      lon,
      city: city || 'Your area',
      region,
      country,
      // Live means "this really is where the request came from" — true for an
      // explicit client fix or a real edge geo header, false for the default.
      live: explicit || hasEdge
    }
  }
  return { lat: 28.6139, lon: 77.209, city: 'New Delhi', region: 'Delhi', country: 'IN', live: false }
}

/* ── Open-Meteo weather (no key) ── */
export type WeatherOut = {
  temperature: number
  humidity: number
  pressure: number
  windSpeed: number
  precipitation: number
  weatherCode: number
  hourly: { time: string[]; temperature: number[]; humidity: number[]; pressure: number[] }
  daily: { time: string[]; tMax: number[]; tMin: number[]; uv: number[] }
}

export async function fetchWeather(geo: GeoCtx, prov: Provenance[]): Promise<WeatherOut> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation,weather_code` +
    `&hourly=temperature_2m,relative_humidity_2m,surface_pressure&past_days=1&forecast_days=2` +
    `&daily=temperature_2m_max,temperature_2m_min,uv_index_max&timezone=auto`
  const j = await safeJson<any>(url, 'Open-Meteo (weather)', prov)
  if (j?.current) {
    return {
      temperature: round(j.current.temperature_2m ?? 24),
      humidity: Math.round(j.current.relative_humidity_2m ?? 55),
      pressure: Math.round(j.current.surface_pressure ?? 1013),
      windSpeed: round(j.current.wind_speed_10m ?? 8),
      precipitation: round(j.current.precipitation ?? 0, 2),
      weatherCode: Number(j.current.weather_code ?? 0),
      hourly: {
        time: (j.hourly?.time || []).slice(0, 48),
        temperature: (j.hourly?.temperature_2m || []).slice(0, 48).map((v: number) => round(v)),
        humidity: (j.hourly?.relative_humidity_2m || []).slice(0, 48).map((v: number) => Math.round(v)),
        pressure: (j.hourly?.surface_pressure || []).slice(0, 48).map((v: number) => Math.round(v))
      },
      daily: {
        time: j.daily?.time || [],
        tMax: (j.daily?.temperature_2m_max || []).map((v: number) => round(v)),
        tMin: (j.daily?.temperature_2m_min || []).map((v: number) => round(v)),
        uv: (j.daily?.uv_index_max || []).map((v: number) => round(v))
      }
    }
  }
  const rng = seeded('weather', geo.lat.toFixed(2), new Date().toISOString().slice(0, 13))
  const base = clamp(gauss(rng, 26, 5), 8, 42)
  const hours = Array.from({ length: 48 }, (_, i) => i)
  return {
    temperature: round(base),
    humidity: Math.round(clamp(gauss(rng, 58, 12), 20, 96)),
    pressure: Math.round(clamp(gauss(rng, 1011, 6), 985, 1035)),
    windSpeed: round(clamp(gauss(rng, 9, 4), 0, 40)),
    precipitation: 0,
    weatherCode: 1,
    hourly: {
      time: hours.map((h) => `${new Date(Date.now() + (h - 24) * 3600000).toISOString().slice(0, 16)}`),
      temperature: hours.map((h) => round(base + 4 * Math.sin((h / 24) * Math.PI * 2 - 1.4))),
      humidity: hours.map((h) => Math.round(clamp(58 - 10 * Math.sin((h / 24) * Math.PI * 2 - 1.4), 20, 95))),
      pressure: hours.map((h) => Math.round(1011 + 3 * Math.cos(h / 7)))
    },
    daily: { time: [], tMax: [], tMin: [], uv: [] }
  }
}

/* ── Open-Meteo air quality (no key) ── */
export type AirOut = {
  aqi: number
  pm25: number
  pm10: number
  ozone: number
  no2: number
  so2: number
  co: number
  pollen: number
  hourlyPm25: number[]
  hourlyTime: string[]
  hourlyAqi: number[]
}

export async function fetchAir(geo: GeoCtx, prov: Provenance[]): Promise<AirOut> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,us_aqi` +
    `&hourly=pm2_5,us_aqi,alder_pollen,birch_pollen,grass_pollen&past_days=1&forecast_days=2&timezone=auto`
  const j = await safeJson<any>(url, 'Open-Meteo (air quality)', prov)
  if (j?.current) {
    const h = j.hourly || {}
    const pollenSeries = ['alder_pollen', 'birch_pollen', 'grass_pollen']
      .map((k) => (h[k] || []).filter((v: any) => typeof v === 'number'))
      .flat()
    const pollenAvg = pollenSeries.length
      ? pollenSeries.reduce((a: number, b: number) => a + b, 0) / pollenSeries.length
      : 0
    return {
      aqi: Math.round(j.current.us_aqi ?? 60),
      pm25: round(j.current.pm2_5 ?? 18),
      pm10: round(j.current.pm10 ?? 34),
      ozone: round(j.current.ozone ?? 62),
      no2: round(j.current.nitrogen_dioxide ?? 14),
      so2: round(j.current.sulphur_dioxide ?? 6),
      co: round(j.current.carbon_monoxide ?? 220),
      pollen: round(pollenAvg),
      hourlyPm25: (h.pm2_5 || []).slice(0, 48).map((v: number) => round(v)),
      hourlyTime: (h.time || []).slice(0, 48),
      hourlyAqi: (h.us_aqi || []).slice(0, 48).map((v: number) => Math.round(v ?? 0))
    }
  }
  const rng = seeded('air', geo.lat.toFixed(2), new Date().toISOString().slice(0, 13))
  const pm = clamp(gauss(rng, 32, 14), 3, 180)
  const hours = Array.from({ length: 48 }, (_, i) => i)
  return {
    aqi: Math.round(clamp(pm * 2.1, 12, 300)),
    pm25: round(pm),
    pm10: round(pm * 1.7),
    ozone: round(clamp(gauss(rng, 64, 16), 10, 160)),
    no2: round(clamp(gauss(rng, 18, 8), 1, 90)),
    so2: round(clamp(gauss(rng, 7, 3), 0, 40)),
    co: round(clamp(gauss(rng, 240, 70), 60, 900)),
    pollen: round(clamp(gauss(rng, 12, 8), 0, 90)),
    hourlyPm25: hours.map((h2) => round(clamp(pm + 9 * Math.sin(h2 / 5) + gauss(rng, 0, 3), 2, 200))),
    hourlyTime: hours.map((h2) => new Date(Date.now() + (h2 - 24) * 3600000).toISOString().slice(0, 16)),
    hourlyAqi: hours.map((h2) => Math.round(clamp((pm + 9 * Math.sin(h2 / 5)) * 2.1, 10, 300)))
  }
}

/* ── openFDA: adverse-event signal + label interactions ── */
export type FdaSignal = {
  drug: string
  totalReports: number
  topReactions: { term: string; count: number; share: number }[]
  interactions: string[]
  boxedWarning: boolean
  live: boolean
}

export async function fetchFdaSignal(drug: string, prov: Provenance[]): Promise<FdaSignal> {
  const q = encodeURIComponent(`"${drug}"`)
  const evUrl =
    `https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:${q}` +
    `&count=patient.reaction.reactionmeddrapt.exact&limit=6`
  const lblUrl = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:${q}&limit=1`

  const [ev, lbl] = await Promise.all([
    safeJson<any>(evUrl, `openFDA events · ${drug}`, prov),
    safeJson<any>(lblUrl, `openFDA label · ${drug}`, prov)
  ])

  const rows: { term: string; count: number }[] = (ev?.results || []).map((r: any) => ({
    term: String(r.term || '').toLowerCase(),
    count: Number(r.count || 0)
  }))
  const total = rows.reduce((a, b) => a + b.count, 0)

  let interactions: string[] = []
  const rawInter: string[] = lbl?.results?.[0]?.drug_interactions || []
  if (rawInter.length) {
    interactions = rawInter
      .join(' ')
      .replace(/\s+/g, ' ')
      .split(/(?<=\.)\s+/)
      .filter((s) => s.length > 40 && s.length < 260)
      .slice(0, 4)
  }

  if (rows.length) {
    return {
      drug,
      totalReports: total,
      topReactions: rows.map((r) => ({ ...r, share: total ? round((r.count / total) * 100) : 0 })),
      interactions,
      boxedWarning: Boolean(lbl?.results?.[0]?.boxed_warning),
      live: true
    }
  }

  const rng = seeded('fda', drug)
  const terms = ['nausea', 'headache', 'fatigue', 'dizziness', 'diarrhoea', 'rash']
  const counts = terms.map(() => Math.round(clamp(gauss(rng, 900, 500), 40, 4000)))
  const tot = counts.reduce((a, b) => a + b, 0)
  return {
    drug,
    totalReports: tot,
    topReactions: terms.map((t, i) => ({ term: t, count: counts[i], share: round((counts[i] / tot) * 100) })),
    interactions: interactions.length ? interactions : ['Interaction profile unavailable from openFDA at this time.'],
    boxedWarning: false,
    live: false
  }
}

/* ── PubMed (NCBI E-utilities) with Europe PMC fallback ── */
export type Citation = { pmid: string; title: string; journal: string; year: string; url: string }

/**
 * Detects a browser (DOM) runtime. Used to skip upstreams that do not send
 * `access-control-allow-origin`, because in a browser those requests are killed
 * by the CORS preflight and only produce a misleading "failed to fetch"
 * provenance entry. On Workers/Node there is no CORS gate, so they are tried.
 */
const IS_BROWSER = typeof document !== 'undefined'

export async function fetchLiterature(term: string, prov: Provenance[], retmax = 5): Promise<Citation[]> {
  const t = encodeURIComponent(term)

  // PubMed E-utilities send no CORS header (verified: 302 → blocked in-browser),
  // so in local-engine mode we go straight to Europe PMC, which mirrors PubMed
  // content and does send `access-control-allow-origin: *`.
  //
  // The skip is RECORDED, not silent. Omitting the entry made the provenance
  // strip differ between transports for the same route (edge reported 2 sources
  // on /literature, the in-browser engine only 1) with nothing on screen to
  // explain the difference — a user would read the shorter strip as data
  // quietly going missing. Emitting an explicit non-live entry keeps both
  // transports' envelopes structurally identical and states the real reason, so
  // `degraded` and the pill tooltip stay truthful.
  if (IS_BROWSER) {
    prov.push({
      source: 'PubMed E-utilities',
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: 'skipped in-browser (no CORS header) — using Europe PMC mirror'
    })
  }
  const search = IS_BROWSER
    ? null
    : await safeJson<any>(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${retmax}&term=${t}&tool=catena&email=catena%40example.org`,
        'PubMed E-utilities',
        prov,
        7000
      )
  const ids: string[] = search?.esearchresult?.idlist || []
  if (ids.length) {
    const sum = await safeJson<any>(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(
        ','
      )}&tool=catena&email=catena%40example.org`,
      'PubMed esummary',
      prov,
      7000
    )
    const out: Citation[] = ids
      .map((id) => {
        const r = sum?.result?.[id]
        if (!r) return null
        return {
          pmid: id,
          title: String(r.title || '').replace(/<[^>]+>/g, ''),
          journal: String(r.source || ''),
          year: String(r.pubdate || '').slice(0, 4),
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        }
      })
      .filter(Boolean) as Citation[]
    if (out.length) return out
  }

  // Europe PMC mirrors PubMed content and is far friendlier to edge callers.
  const epmc = await safeJson<any>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${t}&format=json&pageSize=${retmax}&resultType=lite`,
    'Europe PMC (PubMed mirror)',
    prov,
    7000
  )
  const hits: any[] = epmc?.resultList?.result || []
  if (hits.length) {
    return hits.map((h) => ({
      pmid: String(h.pmid || h.id || ''),
      title: String(h.title || '').replace(/<[^>]+>/g, ''),
      journal: String(h.journalTitle || h.bookOrReportDetails?.publisher || ''),
      year: String(h.pubYear || ''),
      url: h.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${h.pmid}/`
        : `https://europepmc.org/article/${h.source || 'MED'}/${h.id}`
    }))
  }
  return []
}

/* ── USDA FoodData Central (DEMO_KEY works without registration) ── */
export type FoodOut = {
  name: string
  brand: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sodium: number
  sugar: number
  potassium: number
  live: boolean
}

/**
 * USDA note (verified 429):
 * the shared `DEMO_KEY` is globally rate-limited and now answers HTTP 429 for
 * this endpoint, so the nutrition panel was never actually live even when the
 * worker was reachable. Rather than burn a request that is known to fail, we
 * skip the call entirely when no real key is configured and record an explicit
 * provenance entry, so the UI labels the panel non-live with the real reason
 * ("no USDA_API_KEY") instead of a misleading "HTTP 429".
 *
 * Set USDA_API_KEY (free, instant, https://fdc.nal.usda.gov/api-key-signup)
 * to make this panel live. See README → Environment variables.
 */
export async function fetchFood(query: string, key: string, prov: Provenance[]): Promise<FoodOut> {
  const hasRealKey = Boolean(key) && key !== 'DEMO_KEY'
  if (!hasRealKey) {
    prov.push({
      source: `USDA FoodData · ${query}`,
      live: false,
      fetchedAt: new Date().toISOString(),
      detail: 'no USDA_API_KEY (DEMO_KEY is rate-limited: HTTP 429)'
    })
    return offlineFood(query)
  }
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}` +
    `&pageSize=1&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&api_key=${key}`
  const j = await safeJson<any>(url, `USDA FoodData · ${query}`, prov)
  const f = j?.foods?.[0]
  if (f) {
    const num = (id: number, nm: string) => {
      const hit = (f.foodNutrients || []).find(
        (n: any) => n.nutrientId === id || String(n.nutrientName || '').toLowerCase().includes(nm)
      )
      return round(Number(hit?.value || 0))
    }
    return {
      name: String(f.description || query),
      brand: String(f.brandOwner || f.dataType || 'USDA'),
      kcal: num(1008, 'energy'),
      protein: num(1003, 'protein'),
      carbs: num(1005, 'carbohydrate'),
      fat: num(1004, 'total lipid'),
      fiber: num(1079, 'fiber'),
      sodium: num(1093, 'sodium'),
      sugar: num(2000, 'sugars, total'),
      potassium: num(1092, 'potassium'),
      live: true
    }
  }
  return offlineFood(query)
}

/** Deterministic per-query nutrition estimate used when USDA is unavailable. */
function offlineFood(query: string): FoodOut {
  const rng = seeded('food', query)
  return {
    name: query,
    brand: 'offline estimate',
    kcal: Math.round(clamp(gauss(rng, 180, 90), 20, 600)),
    protein: round(clamp(gauss(rng, 9, 6), 0, 40)),
    carbs: round(clamp(gauss(rng, 24, 14), 0, 80)),
    fat: round(clamp(gauss(rng, 7, 5), 0, 40)),
    fiber: round(clamp(gauss(rng, 3, 2), 0, 20)),
    sodium: Math.round(clamp(gauss(rng, 210, 160), 0, 1400)),
    sugar: round(clamp(gauss(rng, 6, 5), 0, 40)),
    potassium: Math.round(clamp(gauss(rng, 280, 160), 20, 1200)),
    live: false
  }
}

/* ── disease.sh / WHO-style public health signal (no key) ── */
export type PublicHealthOut = {
  country: string
  cases: number
  todayCases: number
  active: number
  recovered: number
  population: number
  tests: number
  live: boolean
}

export async function fetchPublicHealth(country: string, prov: Provenance[]): Promise<PublicHealthOut> {
  const j = await safeJson<any>(
    `https://disease.sh/v3/covid-19/countries/${encodeURIComponent(country || 'IN')}?strict=false`,
    'disease.sh (population health)',
    prov
  )
  if (j?.cases) {
    return {
      country: String(j.country || country),
      cases: Number(j.cases || 0),
      todayCases: Number(j.todayCases || 0),
      active: Number(j.active || 0),
      recovered: Number(j.recovered || 0),
      population: Number(j.population || 0),
      tests: Number(j.tests || 0),
      live: true
    }
  }
  const rng = seeded('ph', country)
  const pop = Math.round(clamp(gauss(rng, 4.5e7, 2e7), 1e6, 1.4e9))
  return {
    country: country || 'Region',
    cases: Math.round(pop * 0.03),
    todayCases: Math.round(clamp(gauss(rng, 240, 200), 0, 5000)),
    active: Math.round(pop * 0.0008),
    recovered: Math.round(pop * 0.029),
    population: pop,
    tests: Math.round(pop * 0.9),
    live: false
  }
}
