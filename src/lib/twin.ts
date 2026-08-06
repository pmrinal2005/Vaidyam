/**
 * Layer 0/1 — Digital twin construction and the Personal Causal Knowledge Graph.
 *
 * The twin is NOT a data lake: raw streams are collapsed into entities and
 * weighted causal edges. Everything here is derived from live environment data
 * (Open-Meteo air/weather) plus a deterministic per-user physiological model,
 * so the graph moves with real-world conditions rather than being a fixture.
 */
import type { CausalGraph, GraphEdge, GraphNode } from './types'
import { seeded, gauss, clamp, round, isoDay, fnv1a } from './rand'
import type { AirOut, WeatherOut } from './sources'

export type Vitals = {
  day: string
  sleepHours: number
  sleepEfficiency: number
  deepSleepPct: number
  remPct: number
  restingHr: number
  hrv: number
  spo2: number
  steps: number
  systolic: number
  diastolic: number
  mood: number
  stress: number
  glucose: number
  sodiumMg: number
  hydrationMl: number
  adherence: number
  symptomLoad: number
  pm25: number
  aqi: number
  screenMin: number
  respiratoryRate: number
}

export type Medication = {
  id: string
  name: string
  generic: string
  dose: string
  schedule: string
  adherence: number
  startedDaysAgo: number
  refillInDays: number
  class: string
  lastTaken: string
  nextDue: string
}

/** 30-day longitudinal series. Environment terms are wired to live AQI/weather. */
export function buildVitals(userId: string, air: AirOut, weather: WeatherOut, days = 30): Vitals[] {
  const rng = seeded('vitals', userId)
  const out: Vitals[] = []

  // Per-user constitution — stable traits the twin reasons over.
  const baseSleep = clamp(gauss(rng, 6.9, 0.5), 5.4, 8.4)
  const baseHr = clamp(gauss(rng, 63, 5), 48, 82)
  const baseHrv = clamp(gauss(rng, 52, 9), 22, 95)
  const baseSys = clamp(gauss(rng, 127, 8), 104, 152)
  const pmSensitivity = clamp(gauss(rng, 0.055, 0.02), 0.012, 0.12)
  const livePm = air.pm25

  for (let i = days - 1; i >= 0; i--) {
    const dayRng = seeded('day', userId, i)
    const weekday = new Date(Date.now() - i * 86400000).getDay()
    const weekend = weekday === 0 || weekday === 6

    // Air quality trends toward the live reading as we approach today.
    const recency = (days - 1 - i) / (days - 1)
    const pm25 = clamp(livePm * (0.55 + 0.45 * recency) + gauss(dayRng, 0, 7), 3, 190)
    const aqi = clamp(pm25 * 2.05 + gauss(dayRng, 0, 6), 10, 320)

    const sleepHours = clamp(
      baseSleep + (weekend ? 0.75 : 0) + gauss(dayRng, 0, 0.72) - (pm25 > 60 ? 0.28 : 0),
      3.8,
      9.6
    )
    const sleepEfficiency = clamp(72 + (sleepHours - 6) * 4.4 + gauss(dayRng, 0, 4), 52, 98)
    const deepSleepPct = clamp(13 + (sleepHours - 6) * 2.1 + gauss(dayRng, 0, 2.4), 5, 27)
    const remPct = clamp(20 + (sleepHours - 6) * 1.6 + gauss(dayRng, 0, 2.6), 8, 32)

    const restingHr = clamp(baseHr + (7 - sleepHours) * 1.5 + pm25 * 0.035 + gauss(dayRng, 0, 1.9), 44, 96)
    const hrv = clamp(baseHrv + (sleepHours - 6.8) * 5.6 - pm25 * 0.11 + gauss(dayRng, 0, 4.6), 14, 118)
    const spo2 = clamp(98 - pm25 * 0.012 + gauss(dayRng, 0, 0.5), 92, 100)

    const steps = Math.round(clamp(gauss(dayRng, weekend ? 6100 : 8300, 2600) - pm25 * 12, 600, 21000))
    const stress = clamp(58 - (sleepHours - 6.8) * 7.4 + pm25 * 0.1 + gauss(dayRng, 0, 8), 5, 98)
    const mood = clamp(7.4 + (sleepHours - 6.8) * 0.52 - stress * 0.026 + gauss(dayRng, 0, 0.6), 1.4, 10)

    const sodiumMg = Math.round(clamp(gauss(dayRng, 2450, 620), 900, 5200))
    const adherence = dayRng() > 0.11 ? clamp(gauss(dayRng, 96, 4), 72, 100) : clamp(gauss(dayRng, 58, 14), 20, 82)

    const systolic = clamp(
      baseSys + (sodiumMg - 2300) * 0.0042 + (6.8 - sleepHours) * 1.9 + (100 - adherence) * 0.09 + gauss(dayRng, 0, 3.4),
      96,
      178
    )
    const diastolic = clamp(systolic * 0.64 + gauss(dayRng, 0, 2.4), 58, 112)

    const glucose = clamp(96 + (sodiumMg - 2300) * 0.001 + stress * 0.09 + gauss(dayRng, 0, 6), 68, 186)
    const symptomLoad = clamp(
      pm25 * pmSensitivity + (7 - sleepHours) * 0.9 + (100 - adherence) * 0.035 + gauss(dayRng, 0, 0.55),
      0,
      10
    )

    out.push({
      day: isoDay(-i),
      sleepHours: round(sleepHours, 2),
      sleepEfficiency: round(sleepEfficiency),
      deepSleepPct: round(deepSleepPct),
      remPct: round(remPct),
      restingHr: Math.round(restingHr),
      hrv: Math.round(hrv),
      spo2: round(spo2),
      steps,
      systolic: Math.round(systolic),
      diastolic: Math.round(diastolic),
      mood: round(mood, 1),
      stress: Math.round(stress),
      glucose: Math.round(glucose),
      sodiumMg,
      hydrationMl: Math.round(clamp(gauss(dayRng, 2100, 520), 600, 4200)),
      adherence: Math.round(adherence),
      symptomLoad: round(symptomLoad, 1),
      pm25: round(pm25),
      aqi: Math.round(aqi),
      screenMin: Math.round(clamp(gauss(dayRng, 348, 95), 60, 780)),
      respiratoryRate: round(clamp(14.4 + pm25 * 0.011 + gauss(dayRng, 0, 0.8), 10, 22), 1)
    })
  }
  return out
}

const MED_POOL: Omit<Medication, 'adherence' | 'lastTaken' | 'nextDue' | 'refillInDays' | 'startedDaysAgo'>[] = [
  { id: 'med-met', name: 'Metformin XR', generic: 'metformin', dose: '500 mg', schedule: '2× daily', class: 'Biguanide' },
  { id: 'med-lis', name: 'Lisinopril', generic: 'lisinopril', dose: '10 mg', schedule: '1× daily · AM', class: 'ACE inhibitor' },
  { id: 'med-ator', name: 'Atorvastatin', generic: 'atorvastatin', dose: '20 mg', schedule: '1× daily · PM', class: 'Statin' },
  { id: 'med-sert', name: 'Sertraline', generic: 'sertraline', dose: '50 mg', schedule: '1× daily · AM', class: 'SSRI' },
  { id: 'med-albu', name: 'Albuterol HFA', generic: 'albuterol', dose: '90 mcg', schedule: 'PRN rescue', class: 'SABA' },
  { id: 'med-levo', name: 'Levothyroxine', generic: 'levothyroxine', dose: '75 mcg', schedule: '1× daily · fasting', class: 'Thyroid hormone' }
]

export function buildMedications(userId: string, vitals: Vitals[]): Medication[] {
  const rng = seeded('meds', userId)
  const count = 3 + Math.floor(rng() * 2)
  const recent = vitals.slice(-14)
  const meanAdh = recent.reduce((a, b) => a + b.adherence, 0) / Math.max(1, recent.length)

  return MED_POOL.slice(0, count).map((m, idx) => {
    const mRng = seeded('med', userId, m.id)
    const adherence = Math.round(clamp(meanAdh + gauss(mRng, 0, 6), 55, 100))
    const hour = [8, 9, 21, 8, 0, 7][idx % 6]
    const now = new Date()
    const next = new Date(now)
    next.setHours(hour, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    const last = new Date(next.getTime() - (m.schedule.includes('2×') ? 12 : 24) * 3600000)
    return {
      ...m,
      adherence,
      startedDaysAgo: Math.round(clamp(gauss(mRng, 210, 140), 14, 900)),
      refillInDays: Math.round(clamp(gauss(mRng, 12, 8), 1, 45)),
      lastTaken: last.toISOString(),
      nextDue: next.toISOString()
    }
  })
}

/* ── Correlation helpers used to weight causal edges from real series ── */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return 0
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? 0 : round(num / den, 3)
}

/** Lagged correlation: does x at t-lag predict y at t? */
export function laggedCorr(xs: number[], ys: number[], lagDays: number): number {
  if (lagDays <= 0) return pearson(xs, ys)
  return pearson(xs.slice(0, xs.length - lagDays), ys.slice(lagDays))
}

type EdgeSpec = {
  source: string
  target: string
  relation: string
  from: keyof Vitals
  to: keyof Vitals
  lagHours: number
  invert?: boolean
  literature: string
}

const EDGE_SPECS: EdgeSpec[] = [
  { source: 'env-pm25', target: 'sym-respiratory', relation: 'exacerbates', from: 'pm25', to: 'symptomLoad', lagHours: 12, literature: 'PM2.5 exposure AND respiratory symptoms' },
  { source: 'env-pm25', target: 'vital-spo2', relation: 'depresses', from: 'pm25', to: 'spo2', lagHours: 18, invert: true, literature: 'air pollution AND oxygen saturation' },
  { source: 'sleep-duration', target: 'mental-mood', relation: 'elevates', from: 'sleepHours', to: 'mood', lagHours: 10, literature: 'sleep duration AND mood regulation' },
  { source: 'sleep-duration', target: 'vital-hrv', relation: 'increases', from: 'sleepHours', to: 'hrv', lagHours: 8, literature: 'sleep quality AND heart rate variability' },
  { source: 'sleep-duration', target: 'vital-bp', relation: 'lowers', from: 'sleepHours', to: 'systolic', lagHours: 24, invert: true, literature: 'short sleep duration AND hypertension' },
  { source: 'nutr-sodium', target: 'vital-bp', relation: 'raises', from: 'sodiumMg', to: 'systolic', lagHours: 36, literature: 'dietary sodium AND blood pressure' },
  { source: 'med-adherence', target: 'vital-bp', relation: 'controls', from: 'adherence', to: 'systolic', lagHours: 48, invert: true, literature: 'antihypertensive adherence AND blood pressure control' },
  { source: 'mental-stress', target: 'sleep-duration', relation: 'fragments', from: 'stress', to: 'sleepHours', lagHours: 6, invert: true, literature: 'psychological stress AND sleep fragmentation' },
  { source: 'mental-stress', target: 'vital-glucose', relation: 'destabilises', from: 'stress', to: 'glucose', lagHours: 14, literature: 'stress AND glycaemic variability' },
  { source: 'act-steps', target: 'mental-mood', relation: 'improves', from: 'steps', to: 'mood', lagHours: 6, literature: 'physical activity AND depressive symptoms' },
  { source: 'act-steps', target: 'vital-hr', relation: 'reduces', from: 'steps', to: 'restingHr', lagHours: 72, invert: true, literature: 'exercise AND resting heart rate' },
  { source: 'env-pm25', target: 'act-steps', relation: 'suppresses', from: 'pm25', to: 'steps', lagHours: 4, invert: true, literature: 'air quality AND outdoor physical activity' },
  { source: 'med-adherence', target: 'sym-respiratory', relation: 'suppresses', from: 'adherence', to: 'symptomLoad', lagHours: 24, invert: true, literature: 'medication adherence AND symptom burden' },
  { source: 'behav-screen', target: 'sleep-duration', relation: 'delays', from: 'screenMin', to: 'sleepHours', lagHours: 3, invert: true, literature: 'evening screen exposure AND sleep onset' },
  { source: 'nutr-hydration', target: 'vital-hr', relation: 'stabilises', from: 'hydrationMl', to: 'restingHr', lagHours: 8, invert: true, literature: 'hydration status AND heart rate' }
]

const NODE_DEFS: Record<string, { label: string; domain: GraphNode['domain']; community: number }> = {
  'env-pm25': { label: 'PM2.5 Exposure', domain: 'environment', community: 0 },
  'env-pollen': { label: 'Pollen Index', domain: 'environment', community: 0 },
  'env-pressure': { label: 'Barometric Pressure', domain: 'environment', community: 0 },
  'sleep-duration': { label: 'Sleep Duration', domain: 'sleep', community: 1 },
  'sleep-deep': { label: 'Deep Sleep %', domain: 'sleep', community: 1 },
  'behav-screen': { label: 'Evening Screen Time', domain: 'sleep', community: 1 },
  'med-adherence': { label: 'Medication Adherence', domain: 'medication', community: 2 },
  'med-refill': { label: 'Refill Continuity', domain: 'medication', community: 2 },
  'mental-mood': { label: 'Mood Score', domain: 'mental', community: 3 },
  'mental-stress': { label: 'Stress Load', domain: 'mental', community: 3 },
  'nutr-sodium': { label: 'Sodium Intake', domain: 'nutrition', community: 4 },
  'nutr-hydration': { label: 'Hydration', domain: 'nutrition', community: 4 },
  'act-steps': { label: 'Daily Activity', domain: 'vital', community: 5 },
  'vital-bp': { label: 'Blood Pressure', domain: 'vital', community: 5 },
  'vital-hrv': { label: 'HRV', domain: 'vital', community: 5 },
  'vital-hr': { label: 'Resting HR', domain: 'vital', community: 5 },
  'vital-spo2': { label: 'SpO₂', domain: 'vital', community: 5 },
  'vital-glucose': { label: 'Glucose', domain: 'vital', community: 5 },
  'sym-respiratory': { label: 'Respiratory Symptoms', domain: 'symptom', community: 6 },
  'fin-cost': { label: 'Out-of-pocket Cost', domain: 'finance', community: 7 }
}

const COMMUNITY_LABELS = [
  'Environmental Exposure',
  'Sleep & Circadian',
  'Medication Regimen',
  'Mental Health',
  'Nutrition & Intake',
  'Cardiometabolic',
  'Symptom Expression',
  'Cost & Access'
]

/**
 * Builds the causal graph. Edge strengths are actual lagged correlations
 * computed from the twin's series (GraphRAG-style two-stage: extract entities,
 * then summarise communities).
 */
export function buildGraph(userId: string, vitals: Vitals[], air: AirOut): CausalGraph {
  const series = (k: keyof Vitals) => vitals.map((v) => Number(v[k]))

  const edges: GraphEdge[] = EDGE_SPECS.map((spec) => {
    const lagDays = Math.max(0, Math.round(spec.lagHours / 24))
    let r = laggedCorr(series(spec.from), series(spec.to), lagDays)
    if (spec.invert) r = -r
    const strength = round(clamp(Math.abs(r), 0.08, 0.97), 3)
    return {
      source: spec.source,
      target: spec.target,
      relation: spec.relation,
      strength,
      lagHours: spec.lagHours,
      confidence: round(clamp(0.44 + strength * 0.55, 0.4, 0.985), 3)
    }
  })

  // Auxiliary structural edges (no direct series, weighted by domain priors).
  const rng = seeded('aux', userId)
  const aux: GraphEdge[] = [
    { source: 'env-pollen', target: 'sym-respiratory', relation: 'triggers', strength: round(clamp(air.pollen / 60 + 0.18, 0.1, 0.9), 3), lagHours: 6, confidence: 0.72 },
    { source: 'env-pressure', target: 'sym-respiratory', relation: 'modulates', strength: round(clamp(gauss(rng, 0.28, 0.08), 0.08, 0.6), 3), lagHours: 20, confidence: 0.58 },
    { source: 'sleep-deep', target: 'vital-hrv', relation: 'raises', strength: round(clamp(Math.abs(pearson(series('deepSleepPct'), series('hrv'))), 0.1, 0.95), 3), lagHours: 8, confidence: 0.79 },
    { source: 'med-refill', target: 'med-adherence', relation: 'enables', strength: 0.81, lagHours: 72, confidence: 0.88 },
    { source: 'fin-cost', target: 'med-refill', relation: 'constrains', strength: round(clamp(gauss(rng, 0.46, 0.1), 0.15, 0.8), 3), lagHours: 168, confidence: 0.63 },
    { source: 'sym-respiratory', target: 'mental-mood', relation: 'depresses', strength: round(clamp(Math.abs(pearson(series('symptomLoad'), series('mood'))), 0.1, 0.9), 3), lagHours: 12, confidence: 0.7 }
  ]
  const all = [...edges, ...aux]

  const used = new Set<string>()
  all.forEach((e) => {
    used.add(e.source)
    used.add(e.target)
  })

  const degree: Record<string, number> = {}
  all.forEach((e) => {
    degree[e.source] = (degree[e.source] || 0) + 1
    degree[e.target] = (degree[e.target] || 0) + 1
  })

  const nodes: GraphNode[] = [...used].map((id) => {
    const def = NODE_DEFS[id] || { label: id, domain: 'vital' as const, community: 5 }
    return {
      id,
      label: def.label,
      domain: def.domain,
      kind: 'entity' as const,
      weight: round(clamp((degree[id] || 1) / 6, 0.16, 1), 3),
      community: def.community
    }
  })

  const communities = COMMUNITY_LABELS.map((label, id) => {
    const members = nodes.filter((n) => n.community === id)
    const inner = all.filter(
      (e) => nodes.find((n) => n.id === e.source)?.community === id || nodes.find((n) => n.id === e.target)?.community === id
    )
    const avg = inner.length ? inner.reduce((a, b) => a + b.strength, 0) / inner.length : 0
    return {
      id,
      label,
      size: members.length,
      summary: `${members.length} entities · ${inner.length} incident edges · mean causal strength ${round(avg, 2)}`
    }
  }).filter((c) => c.size > 0)

  const n = nodes.length
  const density = n > 1 ? round((2 * all.length) / (n * (n - 1)), 3) : 0
  return {
    nodes,
    edges: all,
    communities,
    stats: {
      nodes: n,
      edges: all.length,
      density,
      avgDegree: round((2 * all.length) / Math.max(1, n), 2),
      version: `v${(fnv1a(userId + vitals.length) % 900 + 100).toString()}.${vitals.length}`
    }
  }
}

/**
 * HippoRAG-style personalized PageRank over the causal graph.
 * Seeds are the query-matched entities; propagation integrates multi-hop
 * associations in a single retrieval pass.
 */
export function personalizedPageRank(
  graph: CausalGraph,
  seeds: string[],
  damping = 0.85,
  iterations = 40
): Record<string, number> {
  const ids = graph.nodes.map((n) => n.id)
  const idx: Record<string, number> = {}
  ids.forEach((id, i) => (idx[id] = i))

  const out: number[][] = ids.map(() => [])
  const weights: number[][] = ids.map(() => [])
  graph.edges.forEach((e) => {
    const s = idx[e.source]
    const t = idx[e.target]
    if (s === undefined || t === undefined) return
    out[s].push(t)
    weights[s].push(e.strength)
    // Causal graphs still associate backwards for retrieval purposes.
    out[t].push(s)
    weights[t].push(e.strength * 0.6)
  })

  const valid = seeds.filter((s) => idx[s] !== undefined)
  const teleport = new Array(ids.length).fill(0)
  if (valid.length) valid.forEach((s) => (teleport[idx[s]] = 1 / valid.length))
  else teleport.fill(1 / ids.length)

  let rank = teleport.slice()
  for (let it = 0; it < iterations; it++) {
    const next = new Array(ids.length).fill(0)
    for (let i = 0; i < ids.length; i++) {
      const tot = weights[i].reduce((a, b) => a + b, 0)
      if (tot === 0) {
        for (let j = 0; j < ids.length; j++) next[j] += (damping * rank[i]) / ids.length
        continue
      }
      out[i].forEach((j, k) => {
        next[j] += (damping * rank[i] * weights[i][k]) / tot
      })
    }
    for (let j = 0; j < ids.length; j++) next[j] += (1 - damping) * teleport[j]
    rank = next
  }

  const scores: Record<string, number> = {}
  const max = Math.max(...rank, 1e-9)
  ids.forEach((id, i) => (scores[id] = round(rank[i] / max, 4)))
  return scores
}

/** Map free text to graph seed entities (LightRAG dual-level keying). */
export function seedsFromQuery(graph: CausalGraph, query: string): string[] {
  const q = query.toLowerCase()
  const KEYS: Record<string, string[]> = {
    'sleep-duration': ['sleep', 'insomnia', 'rest', 'bedtime', 'tired', 'fatigue'],
    'env-pm25': ['air', 'pollution', 'pm2.5', 'pm25', 'aqi', 'smog', 'outdoor'],
    'med-adherence': ['medic', 'dose', 'pill', 'adher', 'drug', 'refill', 'prescri'],
    'mental-mood': ['mood', 'depress', 'happy', 'anxious', 'mental', 'sad'],
    'mental-stress': ['stress', 'burnout', 'pressure', 'overwhelm', 'cortisol'],
    'nutr-sodium': ['sodium', 'salt', 'diet', 'food', 'nutrition', 'eat'],
    'vital-bp': ['blood pressure', 'bp', 'hypertens', 'systolic', 'diastolic'],
    'vital-glucose': ['glucose', 'sugar', 'diabet', 'a1c', 'insulin'],
    'sym-respiratory': ['asthma', 'cough', 'breath', 'wheez', 'symptom', 'flare'],
    'act-steps': ['exercise', 'steps', 'activity', 'walk', 'workout', 'move'],
    'vital-hrv': ['hrv', 'recovery', 'variability', 'autonomic'],
    'nutr-hydration': ['water', 'hydrat', 'drink', 'fluid'],
    'fin-cost': ['cost', 'money', 'afford', 'insur', 'expens', 'financ']
  }
  const hits = Object.entries(KEYS)
    .filter(([id, words]) => graph.nodes.some((n) => n.id === id) && words.some((w) => q.includes(w)))
    .map(([id]) => id)
  if (hits.length) return hits
  return graph.nodes
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((n) => n.id)
}

/** Risk trajectory derived from the twin's own series + graph edge weights. */
export function riskScores(vitals: Vitals[], graph: CausalGraph) {
  const last14 = vitals.slice(-14)
  const mean = (k: keyof Vitals) => last14.reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, last14.length)
  const edge = (s: string, t: string) => graph.edges.find((e) => e.source === s && e.target === t)?.strength ?? 0.3

  const sys = mean('systolic')
  const sleep = mean('sleepHours')
  const adh = mean('adherence')
  const pm = mean('pm25')
  const stress = mean('stress')
  const glucose = mean('glucose')
  const steps = mean('steps')

  const hypertension = clamp(
    (sys - 108) * 1.55 + (2500 - mean('sodiumMg')) * -0.004 + (7.2 - sleep) * 4.1 * edge('sleep-duration', 'vital-bp'),
    2,
    96
  )
  const respiratory = clamp(pm * 0.72 * edge('env-pm25', 'sym-respiratory') * 2.4 + (100 - adh) * 0.35, 2, 96)
  const metabolic = clamp((glucose - 84) * 1.28 + (8000 - steps) * 0.0022 + stress * 0.16, 2, 96)
  const mental = clamp(stress * 0.68 + (7.2 - sleep) * 5.2 - (mean('mood') - 5) * 4.1, 2, 96)
  const adherenceRisk = clamp((100 - adh) * 1.9, 2, 96)

  return [
    { key: 'hypertension', label: 'Hypertension trajectory', score: Math.round(hypertension), horizon: '5-year' },
    { key: 'respiratory', label: 'Respiratory flare', score: Math.round(respiratory), horizon: '72-hour' },
    { key: 'metabolic', label: 'Metabolic drift', score: Math.round(metabolic), horizon: '12-month' },
    { key: 'mental', label: 'Mental health strain', score: Math.round(mental), horizon: '30-day' },
    { key: 'adherence', label: 'Adherence lapse', score: Math.round(adherenceRisk), horizon: '14-day' }
  ]
}
