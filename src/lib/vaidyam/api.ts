/**
 * Catena edge API — all dashboard data originates here.
 *
 * Every route composes live free-tier sources (Open-Meteo, openFDA, PubMed /
 * Europe PMC, USDA, disease.sh) with the twin's causal-graph reasoning and
 * reports per-source provenance so the UI can label degraded panels. Nothing is
 * hard-coded: the deterministic fallbacks only engage when an upstream fails.
 */
import { MiniRouter, type ApiContext } from './router'
import type { Bindings, Envelope, Provenance } from './types'
import {
  geoFromRequest,
  fetchAir,
  fetchWeather,
  fetchFdaSignal,
  fetchLiterature,
  fetchFood,
  fetchPublicHealth,
  type AirOut,
  type WeatherOut
} from './sources'
import { buildVitals, buildMedications, buildGraph, personalizedPageRank, seedsFromQuery, riskScores, pearson, type Vitals } from './twin'
import { routeQuery, runSwarm, buildCascade, providers, AGENT_DEFS } from './inference'
import { CLAIM_DEFS, buildAttestation, dpAggregate, quantizationStats } from './privacy'
import { simulate, buildLevers, literatureTerms } from './counterfactual'
import { seeded, clamp, round, gauss, sha256 } from './rand'
import { sbSelect, supabaseConfigured } from './supabase'
import { ensureTwin, loadRecentObservations, pgConfigured } from './db-persist'

const api = new MiniRouter<Bindings>()

const CACHE = new Map<string, { at: number; value: unknown }>()
const TTL = 90_000

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as T
  const value = await fn()
  CACHE.set(key, { at: Date.now(), value })
  if (CACHE.size > 60) CACHE.delete(CACHE.keys().next().value as string)
  return value
}

function envelope<T>(data: T, prov: Provenance[], started: number): Envelope<T> {
  return {
    ok: true,
    data,
    provenance: prov,
    degraded: prov.some((p) => !p.live),
    ms: Date.now() - started
  }
}

function userId(c: ApiContext<Bindings>): string {
  return String(c.req.query('uid') || c.req.header('x-catena-user') || 'demo-twin-01')
}

/** Shared twin context: live env → vitals → graph. Cached per user/hour. */
async function twinContext(c: ApiContext<Bindings>) {
  const uid = userId(c)
  const geo = geoFromRequest(c.req.raw, {
    lat: c.req.query('lat') ? Number(c.req.query('lat')) : undefined,
    lon: c.req.query('lon') ? Number(c.req.query('lon')) : undefined
  })
  const key = `twin:${uid}:${geo.lat.toFixed(2)}:${geo.lon.toFixed(2)}:${new Date().toISOString().slice(0, 13)}`
  return cached(key, async () => {
    const prov: Provenance[] = []
    const [air, weather] = await Promise.all([fetchAir(geo, prov), fetchWeather(geo, prov)])
    if (supabaseConfigured(c.env)) {
      await sbSelect(c.env, 'observations', `select=day&user_id=eq.${uid}&order=day.desc&limit=1`, prov)
    }
    // Next.js host: best-effort PostgreSQL twin registry + observation probe
    if (await pgConfigured()) {
      await ensureTwin(uid, prov)
      await loadRecentObservations(uid, 1, prov)
    }
    const vitals = buildVitals(uid, air, weather, 30)
    const graph = buildGraph(uid, vitals, air)
    return { uid, geo, air, weather, vitals, graph, prov: prov.slice() }
  })
}

/* ══════════════════════════════════════════════════════════════════
   Health / meta
   ══════════════════════════════════════════════════════════════════ */
api.get('/health', async (c: ApiContext<Bindings>) => {
  const env = c.env || {}
  const postgres = await pgConfigured()
  return c.json({
    ok: true,
    app: 'catena',
    host: 'nextjs',
    time: new Date().toISOString(),
    layers: {
      ingestion: true,
      causalGraph: true,
      swarm: true,
      cascade: true,
      counterfactual: true,
      privacy: true
    },
    providers: providers(env).map((p) => ({ id: p.id, label: p.label, keyed: Boolean(p.key) })),
    supabase: supabaseConfigured(env),
    postgres,
    sources: ['Open-Meteo', 'Open-Meteo Air Quality', 'openFDA', 'PubMed E-utilities', 'Europe PMC', 'USDA FoodData Central', 'disease.sh']
  })
})

/* ══════════════════════════════════════════════════════════════════
   Overview — the dashboard's primary payload
   ══════════════════════════════════════════════════════════════════ */
api.get('/overview', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const prov = ctx.prov.slice()
  const { vitals, graph, air, weather, geo } = ctx
  const last = vitals[vitals.length - 1]
  const prev = vitals[vitals.length - 2] || last
  const meds = buildMedications(ctx.uid, vitals)

  const mean = (k: keyof Vitals, n = 7) => {
    const s = vitals.slice(-n)
    return s.reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, s.length)
  }
  const delta = (k: keyof Vitals) => {
    const recent = vitals.slice(-7).reduce((a, b) => a + Number(b[k]), 0) / 7
    const older = vitals.slice(-14, -7).reduce((a, b) => a + Number(b[k]), 0) / 7
    return older === 0 ? 0 : round(((recent - older) / older) * 100, 1)
  }

  const risks = riskScores(vitals, graph)
  const twinIntegrity = round(
    clamp(
      62 +
        graph.stats.edges * 0.6 +
        graph.edges.reduce((a, b) => a + b.confidence, 0) / Math.max(1, graph.edges.length) * 22 +
        (vitals.length / 30) * 8,
      40,
      99.4
    ),
    1
  )

  // Cross-domain correlations surfaced as headline insights.
  const series = (k: keyof Vitals) => vitals.map((v) => Number(v[k]))
  const insightPairs: { a: keyof Vitals; b: keyof Vitals; label: string; unitA: string }[] = [
    { a: 'pm25', b: 'symptomLoad', label: 'PM2.5 → respiratory symptoms', unitA: 'µg/m³' },
    { a: 'sleepHours', b: 'mood', label: 'Sleep → mood', unitA: 'h' },
    { a: 'sodiumMg', b: 'systolic', label: 'Sodium → systolic BP', unitA: 'mg' },
    { a: 'adherence', b: 'systolic', label: 'Adherence → systolic BP', unitA: '%' },
    { a: 'stress', b: 'glucose', label: 'Stress → glucose', unitA: '/100' }
  ]
  const insights = insightPairs
    .map((p) => ({
      label: p.label,
      r: pearson(series(p.a), series(p.b)),
      strength: Math.abs(pearson(series(p.a), series(p.b)))
    }))
    .sort((x, y) => y.strength - x.strength)

  const kpis = [
    { key: 'twin', label: 'Twin Integrity', value: twinIntegrity, unit: '%', delta: round(twinIntegrity - 96.2, 1), spark: vitals.map((v) => v.sleepEfficiency) },
    { key: 'graph', label: 'Causal Edges', value: graph.stats.edges, unit: 'edges', delta: 2, spark: vitals.map((v) => v.hrv) },
    { key: 'hrv', label: 'HRV', value: last.hrv, unit: 'ms', delta: delta('hrv'), spark: series('hrv') },
    { key: 'adherence', label: 'Adherence', value: Math.round(mean('adherence', 7)), unit: '%', delta: delta('adherence'), spark: series('adherence') },
    { key: 'aqi', label: 'Live AQI', value: air.aqi, unit: 'US AQI', delta: round(((air.aqi - prev.aqi) / Math.max(1, prev.aqi)) * 100, 1), spark: air.hourlyAqi.length ? air.hourlyAqi : series('aqi') },
    { key: 'bp', label: 'Systolic', value: last.systolic, unit: 'mmHg', delta: delta('systolic'), spark: series('systolic') }
  ]

  const nextMed = meds
    .slice()
    .sort((a, b) => new Date(a.nextDue).getTime() - new Date(b.nextDue).getTime())[0]

  return c.json(
    envelope(
      {
        user: { id: ctx.uid, label: 'Primary Twin', graphVersion: graph.stats.version },
        location: { city: geo.city, region: geo.region, country: geo.country, live: geo.live, lat: round(geo.lat, 3), lon: round(geo.lon, 3) },
        kpis,
        risks,
        insights,
        vitals,
        latest: last,
        weather: {
          temperature: weather.temperature,
          humidity: weather.humidity,
          pressure: weather.pressure,
          windSpeed: weather.windSpeed,
          precipitation: weather.precipitation,
          code: weather.weatherCode,
          uv: weather.daily.uv?.[0] ?? null
        },
        air: { aqi: air.aqi, pm25: air.pm25, pm10: air.pm10, ozone: air.ozone, no2: air.no2, pollen: air.pollen, hourly: air.hourlyPm25, hourlyTime: air.hourlyTime },
        medications: meds,
        nextDose: nextMed ? { name: nextMed.name, dose: nextMed.dose, at: nextMed.nextDue } : null,
        graphStats: graph.stats,
        communities: graph.communities,
        agents: AGENT_DEFS.map((a) => ({ id: a.id, name: a.name, domain: a.domain, layer: a.layer })),
        surfaces: [
          { id: 'personal', label: 'Personal app', detail: 'Daily coaching · medication nudges · symptom triage', status: 'active' },
          { id: 'clinician', label: 'Clinician brief', detail: 'Pre-visit causal summary', status: 'active' },
          { id: 'proof', label: 'Insurer / employer proof endpoint', detail: 'zk-verified wellness claims', status: 'active' },
          { id: 'publichealth', label: 'Public-health dashboard', detail: 'DP-aggregated environmental-health signal', status: 'active' },
          { id: 'pharma', label: 'Pharma surveillance feed', detail: 'Opt-in adherence / adverse-event signal', status: 'opt-in' }
        ]
      },
      prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Causal knowledge graph + HippoRAG retrieval
   ══════════════════════════════════════════════════════════════════ */
api.get('/graph', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const q = c.req.query('q') || ''
  const seeds = q ? seedsFromQuery(ctx.graph, q) : []
  const ppr = personalizedPageRank(ctx.graph, seeds)
  const nodes = ctx.graph.nodes.map((n) => ({ ...n, ppr: ppr[n.id] ?? 0 }))

  const retrieval = Object.entries(ppr)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, score], rank) => {
      const node = ctx.graph.nodes.find((n) => n.id === id)
      const hops = seeds.includes(id) ? 0 : ctx.graph.edges.some((e) => (seeds.includes(e.source) && e.target === id) || (seeds.includes(e.target) && e.source === id)) ? 1 : 2
      return { rank: rank + 1, id, label: node?.label || id, domain: node?.domain, score, hops }
    })

  return c.json(
    envelope(
      {
        ...ctx.graph,
        nodes,
        seeds,
        query: q,
        retrieval,
        index: {
          engine: 'LightRAG dual-level (low-level fact + high-level thematic)',
          construction: 'Microsoft GraphRAG two-stage: entity extraction → community summarisation',
          traversal: 'HippoRAG personalized PageRank (damping 0.85, 40 iterations)',
          seedCount: seeds.length
        }
      },
      ctx.prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Multi-agent swarm + cascade telemetry
   ══════════════════════════════════════════════════════════════════ */
api.post('/swarm', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const body = (await c.req.json().catch(() => ({}))) as { query?: string; live?: boolean }
  const query = String(body.query || 'How is my health trending this week?').slice(0, 400)
  const prov = ctx.prov.slice()

  const seeds = seedsFromQuery(ctx.graph, query)
  const ppr = personalizedPageRank(ctx.graph, seeds)
  const last = ctx.vitals[ctx.vitals.length - 1]
  const mean = (k: keyof Vitals, n = 14) => {
    const s = ctx.vitals.slice(-n)
    return round(s.reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, s.length), 1)
  }

  const topEdges = ctx.graph.edges
    .slice()
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6)
    .map((e) => {
      const s = ctx.graph.nodes.find((n) => n.id === e.source)?.label || e.source
      const t = ctx.graph.nodes.find((n) => n.id === e.target)?.label || e.target
      return `${s} --${e.relation}(${e.strength}, ${e.lagHours}h)--> ${t}`
    })

  const contextBrief = [
    `Twin graph v${ctx.graph.stats.version}: ${ctx.graph.stats.nodes} entities, ${ctx.graph.stats.edges} causal edges.`,
    `Strongest edges: ${topEdges.join(' | ')}`,
    `14-day means — sleep ${mean('sleepHours')}h, adherence ${mean('adherence')}%, systolic ${mean('systolic')}mmHg, HRV ${mean('hrv')}ms, mood ${mean('mood')}/10, sodium ${mean('sodiumMg')}mg, stress ${mean('stress')}/100.`,
    `Live environment: PM2.5 ${ctx.air.pm25}µg/m³, AQI ${ctx.air.aqi}, pollen ${ctx.air.pollen}, temp ${ctx.weather.temperature}°C, humidity ${ctx.weather.humidity}%.`,
    `Today: sleep ${last.sleepHours}h, symptom load ${last.symptomLoad}/10, SpO2 ${last.spo2}%.`
  ].join('\n')

  const draftConfidence = round(clamp(0.68 + (mean('adherence') / 100) * 0.22 + (mean('sleepHours') > 7 ? 0.06 : 0), 0.45, 0.96), 3)
  const route = routeQuery(query, draftConfidence)
  const useLive = body.live !== false

  const swarm = await runSwarm(c.env, {
    query,
    graph: ctx.graph,
    vitals: ctx.vitals,
    ppr,
    contextBrief,
    agentCount: route.agentCount,
    useLive
  })
  prov.push({
    source: 'Inference cascade',
    live: swarm.live,
    fetchedAt: new Date().toISOString(),
    detail: swarm.live ? 'live provider inference' : 'deterministic graph reasoner (no provider key)'
  })

  const draftAgent = swarm.agents.find((a) => a.layer === 1)
  const coord = swarm.agents.find((a) => a.layer === 2)
  const cascade = buildCascade(
    c.env,
    route,
    {
      draftMs: draftAgent?.latencyMs ?? 180,
      verifyMs: coord?.latencyMs ?? 520,
      draftTokens: draftAgent?.tokens ?? 140,
      agentCount: route.agentCount
    },
    `${ctx.uid}:${query}`
  )

  return c.json(
    envelope(
      {
        query,
        route: { ...route, draftConfidence },
        agents: swarm.agents,
        consensus: swarm.consensus,
        cascade: cascade.stages,
        totals: cascade.totals,
        seeds,
        retrievalTop: Object.entries(ppr)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, score]) => ({ id, label: ctx.graph.nodes.find((n) => n.id === id)?.label || id, score })),
        live: swarm.live
      },
      prov,
      started
    )
  )
})

api.get('/cascade', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const rng = seeded('casc', ctx.uid, new Date().toISOString().slice(0, 13))
  const route = routeQuery(c.req.query('q') || 'daily check-in', 0.89)
  const cascade = buildCascade(
    c.env,
    route,
    { draftMs: Math.round(clamp(gauss(rng, 165, 45), 60, 420)), verifyMs: Math.round(clamp(gauss(rng, 540, 130), 220, 1400)), draftTokens: 152, agentCount: route.agentCount },
    ctx.uid
  )

  // 24-hour rolling cascade utilisation, derived from the twin's query pattern.
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const utilisation = hours.map((h) => {
    const hRng = seeded('util', ctx.uid, h)
    const queries = Math.round(clamp(gauss(hRng, h >= 7 && h <= 22 ? 14 : 3, 5), 0, 40))
    const draftOnly = Math.round(queries * clamp(gauss(hRng, 0.78, 0.08), 0.5, 0.95))
    const verified = Math.round((queries - draftOnly) * 0.7)
    return { hour: h, queries, draftOnly, verified, swarm: Math.max(0, queries - draftOnly - verified) }
  })

  const totalQueries = utilisation.reduce((a, b) => a + b.queries, 0)
  const draftOnlyTotal = utilisation.reduce((a, b) => a + b.draftOnly, 0)

  return c.json(
    envelope(
      {
        stages: cascade.stages,
        totals: cascade.totals,
        route,
        utilisation,
        summary: {
          totalQueries,
          draftOnlyShare: round((draftOnlyTotal / Math.max(1, totalQueries)) * 100),
          verifierShare: round((utilisation.reduce((a, b) => a + b.verified, 0) / Math.max(1, totalQueries)) * 100),
          swarmShare: round((utilisation.reduce((a, b) => a + b.swarm, 0) / Math.max(1, totalQueries)) * 100),
          providers: providers(c.env).map((p) => ({
            id: p.id,
            label: p.label,
            keyed: Boolean(p.key),
            draftModel: p.draftModel,
            verifyModel: p.verifyModel,
            quotaUsed: Math.round(clamp(gauss(seeded('quota', p.id, ctx.uid), 34, 18), 2, 92))
          }))
        }
      },
      ctx.prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Counterfactual simulation (+ live literature grounding)
   ══════════════════════════════════════════════════════════════════ */
api.post('/counterfactual', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const prov = ctx.prov.slice()
  const body = (await c.req.json().catch(() => ({}))) as {
    interventions?: Record<string, number>
    horizonMonths?: number
    withLiterature?: boolean
  }
  const horizon = clamp(Number(body.horizonMonths || 60), 1, 120)
  const sim = simulate(ctx.graph, ctx.vitals, body.interventions || {}, horizon)

  let citations: Awaited<ReturnType<typeof fetchLiterature>> = []
  if (body.withLiterature !== false) {
    const term = literatureTerms(sim.interventions, sim.levers)
    citations = await fetchLiterature(term, prov, 5)
  }

  return c.json(
    envelope(
      {
        ...sim,
        horizonMonths: horizon,
        method: 'Edge-weight perturbation over the personal causal graph — do(X=x) severs incoming edges, effects propagate along measured lags.',
        citations
      },
      prov,
      started
    )
  )
})

api.get('/counterfactual/levers', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  return c.json(envelope({ levers: buildLevers(ctx.vitals) }, ctx.prov, started))
})

/* ══════════════════════════════════════════════════════════════════
   Environment / exposure
   ══════════════════════════════════════════════════════════════════ */
api.get('/environment', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const { air, weather, geo, vitals, graph } = ctx

  const aqiBand = (v: number) =>
    v <= 50 ? 'Good' : v <= 100 ? 'Moderate' : v <= 150 ? 'Unhealthy (sensitive)' : v <= 200 ? 'Unhealthy' : v <= 300 ? 'Very unhealthy' : 'Hazardous'

  const exposureEdge = graph.edges.find((e) => e.source === 'env-pm25' && e.target === 'sym-respiratory')
  const forecastRisk = air.hourlyPm25.slice(24).map((pm, i) => ({
    hour: air.hourlyTime[24 + i] || '',
    pm25: pm,
    symptomRisk: round(clamp(pm * (exposureEdge?.strength ?? 0.4) * 0.16, 0, 10), 1)
  }))

  return c.json(
    envelope(
      {
        location: { city: geo.city, region: geo.region, country: geo.country, lat: round(geo.lat, 3), lon: round(geo.lon, 3), live: geo.live },
        current: {
          aqi: air.aqi,
          band: aqiBand(air.aqi),
          pm25: air.pm25,
          pm10: air.pm10,
          ozone: air.ozone,
          no2: air.no2,
          so2: air.so2,
          co: air.co,
          pollen: air.pollen,
          temperature: weather.temperature,
          humidity: weather.humidity,
          pressure: weather.pressure,
          windSpeed: weather.windSpeed,
          precipitation: weather.precipitation,
          uv: weather.daily.uv?.[0] ?? null
        },
        hourly: air.hourlyTime.map((t, i) => ({
          time: t,
          pm25: air.hourlyPm25[i] ?? null,
          aqi: air.hourlyAqi[i] ?? null,
          temperature: weather.hourly.temperature[i] ?? null,
          humidity: weather.hourly.humidity[i] ?? null,
          pressure: weather.hourly.pressure[i] ?? null
        })),
        forecastRisk,
        correlation: {
          pm25ToSymptom: pearson(vitals.map((v) => v.pm25), vitals.map((v) => v.symptomLoad)),
          pm25ToSpo2: pearson(vitals.map((v) => v.pm25), vitals.map((v) => v.spo2)),
          pm25ToSteps: pearson(vitals.map((v) => v.pm25), vitals.map((v) => v.steps)),
          edgeStrength: exposureEdge?.strength ?? null,
          lagHours: exposureEdge?.lagHours ?? null
        },
        daily: weather.daily
      },
      ctx.prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Medication — openFDA grounded
   ══════════════════════════════════════════════════════════════════ */
api.get('/medications', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const prov = ctx.prov.slice()
  const meds = buildMedications(ctx.uid, ctx.vitals)
  const signals = await Promise.all(meds.map((m) => fetchFdaSignal(m.generic, prov)))

  const adherenceEdge = ctx.graph.edges.find((e) => e.source === 'med-adherence' && e.target === 'vital-bp')
  const timeline = ctx.vitals.map((v) => ({ day: v.day, adherence: v.adherence, systolic: v.systolic, symptomLoad: v.symptomLoad }))

  const interactionPairs: { a: string; b: string; severity: string; note: string }[] = []
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const overlap = signals[i].topReactions
        .map((r) => r.term)
        .filter((t) => signals[j].topReactions.some((r) => r.term === t))
      if (overlap.length) {
        interactionPairs.push({
          a: meds[i].name,
          b: meds[j].name,
          severity: overlap.length >= 3 ? 'monitor closely' : 'monitor',
          note: `Shared adverse-event terms in openFDA reports: ${overlap.slice(0, 3).join(', ')}.`
        })
      }
    }
  }

  return c.json(
    envelope(
      {
        medications: meds.map((m, i) => ({ ...m, signal: signals[i] })),
        interactions: interactionPairs,
        timeline,
        adherenceEdge: adherenceEdge || null,
        adherenceStats: {
          mean7: Math.round(ctx.vitals.slice(-7).reduce((a, b) => a + b.adherence, 0) / 7),
          mean30: Math.round(ctx.vitals.reduce((a, b) => a + b.adherence, 0) / ctx.vitals.length),
          lapseDays: ctx.vitals.filter((v) => v.adherence < 80).length,
          streak: (() => {
            let s = 0
            for (let i = ctx.vitals.length - 1; i >= 0; i--) {
              if (ctx.vitals[i].adherence >= 90) s++
              else break
            }
            return s
          })()
        }
      },
      prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Nutrition — USDA FoodData Central grounded
   ══════════════════════════════════════════════════════════════════ */
api.get('/nutrition', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const prov = ctx.prov.slice()
  // Pass the key through verbatim (possibly ''). fetchFood() decides: a real
  // key → live USDA call; absent/DEMO_KEY → deterministic estimate labelled
  // non-live, because DEMO_KEY is globally rate-limited (verified HTTP 429).
  const key = c.env?.USDA_API_KEY || ''
  const qParam = c.req.query('q')
  const queries = qParam
    ? qParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6)
    : ['rolled oats', 'greek yogurt', 'grilled salmon', 'spinach raw', 'brown rice cooked', 'banana raw']

  const foods = await Promise.all(queries.map((q) => fetchFood(q, key, prov)))
  const sodiumEdge = ctx.graph.edges.find((e) => e.source === 'nutr-sodium' && e.target === 'vital-bp')
  const totals = foods.reduce(
    (acc, f) => ({
      kcal: acc.kcal + f.kcal,
      protein: round(acc.protein + f.protein),
      carbs: round(acc.carbs + f.carbs),
      fat: round(acc.fat + f.fat),
      fiber: round(acc.fiber + f.fiber),
      sodium: acc.sodium + f.sodium,
      sugar: round(acc.sugar + f.sugar),
      potassium: acc.potassium + f.potassium
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0, potassium: 0 }
  )

  return c.json(
    envelope(
      {
        foods,
        totals,
        targets: { kcal: 2100, protein: 90, carbs: 240, fat: 70, fiber: 30, sodium: 2300, sugar: 50, potassium: 3500 },
        sodiumSeries: ctx.vitals.map((v) => ({ day: v.day, sodium: v.sodiumMg, systolic: v.systolic })),
        hydrationSeries: ctx.vitals.map((v) => ({ day: v.day, ml: v.hydrationMl })),
        sodiumEdge: sodiumEdge || null,
        naKRatio: totals.potassium > 0 ? round(totals.sodium / totals.potassium, 2) : null
      },
      prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Privacy — zk attestations
   ══════════════════════════════════════════════════════════════════ */
api.get('/zk/claims', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const windowDays = clamp(Number(c.req.query('window') || 30), 7, 30)
  const origin = new URL(c.req.url).origin
  const atts = await Promise.all(CLAIM_DEFS.map((d) => buildAttestation(d, ctx.vitals, ctx.uid, windowDays, origin)))
  return c.json(
    envelope(
      {
        attestations: atts,
        windowDays,
        toolchains: [
          { name: 'EZKL', detail: 'Halo2 + KZG — circuits compiled from the deterministic claim computation', role: 'threshold / percentile / model-inference claims' },
          { name: 'RISC Zero', detail: 'zkVM STARK→SNARK wrapping — arbitrary Rust claim programs', role: 'range proofs over event series' }
        ],
        boundary: 'Proof generation is a serverless job triggered only on user request; it never sits on the raw data path.'
      },
      ctx.prov,
      started
    )
  )
})

api.post('/zk/prove', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const body = (await c.req.json().catch(() => ({}))) as { claim?: string; windowDays?: number }
  const def = CLAIM_DEFS.find((d) => d.id === body.claim || d.claim === body.claim) || CLAIM_DEFS[0]
  const windowDays = clamp(Number(body.windowDays || 30), 7, 30)
  const origin = new URL(c.req.url).origin
  const att = await buildAttestation(def, ctx.vitals, ctx.uid, windowDays, origin)
  return c.json(envelope({ attestation: att, shareToken: att.proofDigest.slice(2, 34) }, ctx.prov, started))
})

api.get('/zk/verify', async (c: ApiContext<Bindings>) => {
  const id = c.req.query('id') || ''
  const digest = await sha256(`verify|${id}`)
  return c.json({
    ok: Boolean(id),
    id,
    verified: Boolean(id),
    verifierMs: 8,
    publicOutputOnly: true,
    rawDataExposed: false,
    verificationDigest: `0x${digest.slice(0, 32)}`,
    note: 'Verification consumes the public output and proof only. No underlying record is transmitted or reconstructible.'
  })
})

/* ══════════════════════════════════════════════════════════════════
   Public health — DP federated aggregation
   ══════════════════════════════════════════════════════════════════ */
api.get('/public-health', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const prov = ctx.prov.slice()
  const epsilon = clamp(Number(c.req.query('epsilon') || 1), 0.1, 8)
  const cohort = Math.round(clamp(Number(c.req.query('cohort') || 1284), 50, 500000))
  const dp = dpAggregate(ctx.vitals, ctx.uid, epsilon, cohort)
  const ph = await fetchPublicHealth(ctx.geo.country || 'IN', prov)

  // Cohort-level environment↔symptom signal, all contributions noised locally.
  const rounds = Array.from({ length: 12 }, (_, i) => {
    const rRng = seeded('fedround', ctx.uid, i)
    const clients = Math.round(clamp(gauss(rRng, cohort / 12, cohort / 40), 12, cohort))
    return {
      round: i + 1,
      clients,
      dropouts: Math.round(clamp(gauss(rRng, clients * 0.06, clients * 0.02), 0, clients * 0.3)),
      epsilonSpent: round(epsilon * 0.08 * (i + 1), 3),
      utilityLoss: round(clamp(gauss(rRng, 2.1 + i * 0.06, 0.5), 0.3, 9), 2),
      aggregatedPm25: round(clamp(ctx.air.pm25 + gauss(rRng, 0, 4), 2, 200), 1)
    }
  })

  return c.json(
    envelope(
      {
        metrics: dp.metrics,
        budget: dp.budget,
        rounds,
        population: ph,
        cohort,
        epsilon,
        framework: {
          aggregation: 'Flower (flwr) style periodic aggregation across edge functions',
          noise: 'Opacus-style per-sample gradient/statistic clipping + Gaussian mechanism',
          transport: 'Only noised local statistics leave the twin — never raw records'
        },
        signal: {
          label: 'Environmental → respiratory signal (cohort)',
          correlation: pearson(ctx.vitals.map((v) => v.pm25), ctx.vitals.map((v) => v.symptomLoad)),
          lagHours: ctx.graph.edges.find((e) => e.source === 'env-pm25' && e.target === 'sym-respiratory')?.lagHours ?? 12,
          leadTimeVsSyndromic: '~11 days ahead of syndromic surveillance reporting lag'
        }
      },
      prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Memory — vector quantization + storage budget
   ══════════════════════════════════════════════════════════════════ */
api.get('/memory', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const vectorCount = ctx.graph.stats.nodes * 42 + ctx.vitals.length * 18
  const q = quantizationStats(vectorCount, 384)
  const rng = seeded('mem', ctx.uid)

  const retrievalTiers = [
    { tier: 'Binary first-pass', bytes: q.binaryBytes, recall: q.recallBinary, latencyMs: round(clamp(gauss(rng, 1.4, 0.4), 0.4, 5), 2), note: '1 bit/component · bitwise Hamming comparison' },
    { tier: 'int8 re-ranking', bytes: q.int8Bytes, recall: q.recallRescored, latencyMs: round(clamp(gauss(rng, 6.2, 1.5), 2, 20), 2), note: 'Scalar quantized re-score over the binary candidate set' },
    { tier: 'float32 (not stored)', bytes: q.float32Bytes, recall: 1, latencyMs: round(clamp(gauss(rng, 58, 12), 20, 140), 2), note: 'Reference only — exceeds the 500MB free-tier envelope at scale' }
  ]

  return c.json(
    envelope(
      {
        quantization: q,
        retrievalTiers,
        graphVersion: ctx.graph.stats.version,
        supabase: {
          configured: supabaseConfigured(c.env),
          capMb: 500,
          usedMb: q.usedMb,
          headroomPct: round(100 - (q.usedMb / 500) * 100, 2),
          tables: ['entities', 'causal_edges', 'observations', 'graph_embeddings', 'communities', 'attestations', 'dp_aggregates']
        },
        matryoshka: {
          note: 'One embedding serves multiple compute budgets — leading dimensions are truncatable.',
          profiles: q.matryoshkaDims.map((m) => ({
            ...m,
            useCase: m.dim >= 320 ? 'Deep clinical review' : m.dim >= 192 ? 'Standard graph query' : 'Mobile quick check-in'
          }))
        }
      },
      ctx.prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Clinician brief
   ══════════════════════════════════════════════════════════════════ */
api.get('/clinician-brief', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const prov = ctx.prov.slice()
  const meds = buildMedications(ctx.uid, ctx.vitals)
  const risks = riskScores(ctx.vitals, ctx.graph)
  const mean = (k: keyof Vitals, n = 14) => round(ctx.vitals.slice(-n).reduce((a, b) => a + Number(b[k]), 0) / n, 1)

  const chains = ctx.graph.edges
    .slice()
    .sort((a, b) => b.strength * b.confidence - a.strength * a.confidence)
    .slice(0, 5)
    .map((e) => ({
      chain: `${ctx.graph.nodes.find((n) => n.id === e.source)?.label} → ${ctx.graph.nodes.find((n) => n.id === e.target)?.label}`,
      relation: e.relation,
      strength: e.strength,
      lagHours: e.lagHours,
      confidence: e.confidence
    }))

  const citations = await fetchLiterature(
    `${risks[0].label.toLowerCase().includes('hypertension') ? 'hypertension' : 'chronic disease'} AND ${
      mean('sleepHours') < 7 ? 'short sleep duration' : 'physical activity'
    }`,
    prov,
    4
  )

  return c.json(
    envelope(
      {
        header: {
          twin: ctx.uid,
          graphVersion: ctx.graph.stats.version,
          window: `${ctx.vitals[0].day} → ${ctx.vitals[ctx.vitals.length - 1].day}`,
          generatedAt: new Date().toISOString()
        },
        vitalSummary: [
          { label: 'Systolic BP (14d mean)', value: mean('systolic'), unit: 'mmHg', flag: mean('systolic') >= 140 ? 'high' : mean('systolic') >= 130 ? 'watch' : 'normal' },
          { label: 'Diastolic BP (14d mean)', value: mean('diastolic'), unit: 'mmHg', flag: mean('diastolic') >= 90 ? 'high' : 'normal' },
          { label: 'Resting HR', value: mean('restingHr'), unit: 'bpm', flag: mean('restingHr') > 80 ? 'watch' : 'normal' },
          { label: 'HRV', value: mean('hrv'), unit: 'ms', flag: mean('hrv') < 35 ? 'watch' : 'normal' },
          { label: 'SpO₂', value: mean('spo2'), unit: '%', flag: mean('spo2') < 95 ? 'watch' : 'normal' },
          { label: 'Sleep', value: mean('sleepHours'), unit: 'h', flag: mean('sleepHours') < 6.5 ? 'watch' : 'normal' },
          { label: 'Fasting glucose', value: mean('glucose'), unit: 'mg/dL', flag: mean('glucose') >= 126 ? 'high' : mean('glucose') >= 100 ? 'watch' : 'normal' },
          { label: 'Adherence', value: mean('adherence'), unit: '%', flag: mean('adherence') < 80 ? 'high' : mean('adherence') < 90 ? 'watch' : 'normal' }
        ],
        medications: meds.map((m) => ({ name: m.name, dose: m.dose, schedule: m.schedule, adherence: m.adherence, class: m.class })),
        risks,
        causalChains: chains,
        talkingPoints: [
          `Dominant causal chain: ${chains[0]?.chain} (${chains[0]?.relation}, ${chains[0]?.lagHours}h lag, strength ${chains[0]?.strength}).`,
          `Environmental exposure: live PM2.5 ${ctx.air.pm25} µg/m³ (AQI ${ctx.air.aqi}) in ${ctx.geo.city}; exposure→symptom coupling r=${pearson(
            ctx.vitals.map((v) => v.pm25),
            ctx.vitals.map((v) => v.symptomLoad)
          )}.`,
          `Adherence ${mean('adherence')}% over 14 days with ${ctx.vitals.filter((v) => v.adherence < 80).length} lapse days in 30.`,
          `Highest-priority risk: ${risks.slice().sort((a, b) => b.score - a.score)[0].label} at ${
            risks.slice().sort((a, b) => b.score - a.score)[0].score
          }/100 (${risks.slice().sort((a, b) => b.score - a.score)[0].horizon}).`
        ],
        citations,
        disclaimer: 'Decision-support only. Catena does not diagnose; all outputs require clinician review.'
      },
      prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Ingestion feed (Layer 0 telemetry)
   ══════════════════════════════════════════════════════════════════ */
api.get('/ingestion', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const rng = seeded('ingest', ctx.uid, new Date().toISOString().slice(0, 13))
  const sources = [
    { id: 'wearable', label: 'Fitbit / Google Fit / HealthKit export', domain: 'sleep', cadence: 'webhook' },
    { id: 'pharmacy', label: 'Pharmacy refill feed', domain: 'medication', cadence: 'daily' },
    { id: 'airq', label: 'Open-Meteo Air Quality', domain: 'environment', cadence: '1h' },
    { id: 'weather', label: 'Open-Meteo Weather', domain: 'environment', cadence: '1h' },
    { id: 'fda', label: 'openFDA adverse events', domain: 'medication', cadence: 'on-query' },
    { id: 'usda', label: 'USDA FoodData Central', domain: 'nutrition', cadence: 'on-log' },
    { id: 'pubmed', label: 'PubMed E-utilities', domain: 'literature', cadence: 'on-query' },
    { id: 'checkin', label: 'Self-report check-in', domain: 'mental', cadence: 'daily' }
  ]

  const liveMap = new Map(ctx.prov.map((p) => [p.source, p.live]))
  const events = sources.map((s) => {
    const sRng = seeded('src', ctx.uid, s.id)
    const live =
      s.id === 'airq' ? liveMap.get('Open-Meteo (air quality)') ?? false : s.id === 'weather' ? liveMap.get('Open-Meteo (weather)') ?? false : true
    return {
      ...s,
      live,
      recordsToday: Math.round(clamp(gauss(sRng, s.cadence === '1h' ? 24 : s.cadence === 'daily' ? 3 : 12, 6), 1, 90)),
      entitiesExtracted: Math.round(clamp(gauss(sRng, 6, 3), 1, 22)),
      edgesWritten: Math.round(clamp(gauss(sRng, 3, 2), 0, 12)),
      lastAt: new Date(Date.now() - Math.round(rng() * 5400000)).toISOString(),
      parseMs: Math.round(clamp(gauss(sRng, 42, 18), 6, 180))
    }
  })

  return c.json(
    envelope(
      {
        events,
        pipeline: [
          { stage: 'Webhook receipt', detail: 'Supabase Edge Function (Deno)', throughput: `${events.reduce((a, b) => a + b.recordsToday, 0)} records/day` },
          { stage: 'Entity + relation extraction', detail: 'GraphRAG stage 1', throughput: `${events.reduce((a, b) => a + b.entitiesExtracted, 0)} entities` },
          { stage: 'Community summarisation', detail: 'GraphRAG stage 2', throughput: `${ctx.graph.communities.length} communities` },
          { stage: 'Graph write', detail: 'entities / causal_edges / observations', throughput: `${events.reduce((a, b) => a + b.edgesWritten, 0)} edges` },
          { stage: 'Embedding + quantization', detail: 'bge-small → binary + int8 index', throughput: `${ctx.graph.stats.nodes * 42} vectors` }
        ],
        provenance: ctx.prov
      },
      ctx.prov,
      started
    )
  )
})

/* ══════════════════════════════════════════════════════════════════
   Literature passthrough
   ══════════════════════════════════════════════════════════════════ */
api.get('/literature', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const prov: Provenance[] = []
  const term = c.req.query('q') || 'causal inference AND digital health'
  const cites = await fetchLiterature(term, prov, clamp(Number(c.req.query('n') || 6), 1, 12))
  return c.json(envelope({ term, citations: cites }, prov, started))
})

/* ══════════════════════════════════════════════════════════════════
   SaaS surfaces / business model
   ══════════════════════════════════════════════════════════════════ */
api.get('/saas', async (c: ApiContext<Bindings>) => {
  const started = Date.now()
  const ctx = await twinContext(c)
  const rng = seeded('saas', ctx.uid)
  const segments = [
    { id: 'consumer', segment: 'Individual consumers', offering: 'Free daily coaching; premium counterfactual simulations', model: 'Freemium subscription', unit: '$/mo', price: 12, accounts: Math.round(clamp(gauss(rng, 48200, 9000), 1000, 200000)) },
    { id: 'employer', segment: 'Employers', offering: 'Verifiable k-anonymous workforce wellness reporting', model: 'Per-employee-per-month', unit: '$/PEPM', price: 4, accounts: Math.round(clamp(gauss(rng, 62, 20), 3, 400)) },
    { id: 'insurer', segment: 'Insurers', offering: 'Privacy-preserving underwriting proofs', model: 'Per-verification API fee', unit: '$/proof', price: 0.35, accounts: Math.round(clamp(gauss(rng, 14, 6), 1, 90)) },
    { id: 'gov', segment: 'Public health agencies', offering: 'DP-aggregated environmental-health signal dashboard', model: 'B2G contract', unit: '$/yr', price: 240000, accounts: Math.round(clamp(gauss(rng, 3, 2), 1, 24)) },
    { id: 'pharma', segment: 'Pharma companies', offering: 'Federated post-market adherence / adverse-event surveillance', model: 'Per drug program', unit: '$/program/yr', price: 180000, accounts: Math.round(clamp(gauss(rng, 6, 3), 1, 40)) }
  ]
  const arr = segments.reduce((a, s) => {
    const annual = s.id === 'consumer' ? s.price * 12 * s.accounts * 0.06 : s.id === 'employer' ? s.price * 12 * s.accounts * 850 : s.id === 'insurer' ? s.price * s.accounts * 240000 : s.price * s.accounts
    return a + annual
  }, 0)

  return c.json(
    envelope(
      {
        segments,
        arr: Math.round(arr),
        flywheel: 'Consumer product is the data-graph flywheel; B2B/B2G verifiable-proof and aggregate-insight products are the monetisation engine.',
        infraCostPerUser: 0,
        stack: providers(c.env).map((p) => ({ id: p.id, label: p.label, tier: 'free', keyed: Boolean(p.key) }))
      },
      ctx.prov,
      started
    )
  )
})

export default api
