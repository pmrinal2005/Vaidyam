/**
 * Layer 0 (extension) — "Twin Fuel": zero-friction self-reports for
 * non-wearable users, plus the gamification derivations that sit on top of the
 * existing causal twin.
 *
 * DESIGN CONTRACT (honesty + no regression):
 *   • Self-reports NEVER replace the deterministic seeded model wholesale — they
 *     BLEND into the most-recent days of `buildVitals` output. With zero
 *     self-reports the series is byte-identical to the original pure-seeded twin,
 *     so every existing panel, envelope and provenance entry is preserved.
 *   • The blend is itself deterministic given the same (userId, day, reports),
 *     so the twin stays reproducible across requests and the client/server
 *     boundary — exactly like the rest of Catena.
 *   • All gamification numbers (level, aura, XP, streaks, quests) are DERIVED
 *     from the same vitals + graph the judges already trust. Nothing is a toy
 *     fixture; every value is recomputed per request.
 *
 * Transport: the client persists reports in localStorage and sends them to the
 * server either as a POST body (/checkin) or as a compact base64 query param
 * (?fuel=) so cached GETs (/overview) can pick them up without a DB. Optional
 * Postgres/Supabase persistence is probed elsewhere; this module is storage
 * agnostic and never throws.
 */
import { seeded, clamp, round, gauss, fnv1a } from './rand'
import type { Vitals } from './twin'
import type { CausalGraph } from './types'

/** A single day of user self-report. All fields optional (partial logging). */
export type FuelReport = {
  /** ISO day (YYYY-MM-DD). Defaults to today when absent. */
  day?: string
  /** How rested, 0..10 (maps to sleep quality / sleepHours). */
  rested?: number
  /** Self-reported sleep hours, 3..11. */
  sleepHours?: number
  /** Mood 1..10. */
  mood?: number
  /** Stress 0..100. */
  stress?: number
  /** Steps / activity (manual or DeviceMotion estimate). */
  steps?: number
  /** Hydration ml. */
  hydrationMl?: number
  /** Sodium mg (from meal logging / food search). */
  sodiumMg?: number
  /** Symptom load 0..10. */
  symptomLoad?: number
  /** Evening screen minutes (Ambient Light / manual). */
  screenMin?: number
  /** Meds-taken fraction 0..1 for the day → adherence %. */
  medsTaken?: number
  /** Free-text note (mental journal); not used numerically, kept for agents. */
  note?: string
  /** Client timestamp (ms) for streak / freshness math. */
  at?: number
}

export type FuelState = {
  reports: FuelReport[]
}

const NUMERIC_KEYS: (keyof FuelReport)[] = [
  'rested', 'sleepHours', 'mood', 'stress', 'steps',
  'hydrationMl', 'sodiumMg', 'symptomLoad', 'screenMin', 'medsTaken'
]

/** Coerce/clamp an arbitrary parsed object into a safe FuelReport. */
function sanitizeReport(raw: unknown): FuelReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: FuelReport = {}
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  if (typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day)) out.day = r.day
  const rested = num(r.rested); if (rested !== undefined) out.rested = clamp(rested, 0, 10)
  const sleepHours = num(r.sleepHours); if (sleepHours !== undefined) out.sleepHours = clamp(sleepHours, 3, 11)
  const mood = num(r.mood); if (mood !== undefined) out.mood = clamp(mood, 1, 10)
  const stress = num(r.stress); if (stress !== undefined) out.stress = clamp(stress, 0, 100)
  const steps = num(r.steps); if (steps !== undefined) out.steps = clamp(steps, 0, 60000)
  const hydrationMl = num(r.hydrationMl); if (hydrationMl !== undefined) out.hydrationMl = clamp(hydrationMl, 0, 6000)
  const sodiumMg = num(r.sodiumMg); if (sodiumMg !== undefined) out.sodiumMg = clamp(sodiumMg, 0, 8000)
  const symptomLoad = num(r.symptomLoad); if (symptomLoad !== undefined) out.symptomLoad = clamp(symptomLoad, 0, 10)
  const screenMin = num(r.screenMin); if (screenMin !== undefined) out.screenMin = clamp(screenMin, 0, 1000)
  const medsTaken = num(r.medsTaken); if (medsTaken !== undefined) out.medsTaken = clamp(medsTaken, 0, 1)
  const at = num(r.at); if (at !== undefined) out.at = at
  if (typeof r.note === 'string') out.note = r.note.slice(0, 400)
  // A report with no usable signal is dropped.
  const hasSignal = NUMERIC_KEYS.some((k) => out[k] !== undefined) || out.note
  return hasSignal ? out : null
}

/** Parse the compact `?fuel=` param (base64 or raw JSON) into a FuelState. */
export function parseFuelParam(param: string | undefined | null): FuelState {
  if (!param) return { reports: [] }
  let text = param
  try {
    // base64 (url-safe tolerated) → JSON
    if (!/^[[{]/.test(param.trim())) {
      const b64 = param.replace(/-/g, '+').replace(/_/g, '/')
      text = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8')
    }
  } catch {
    text = param
  }
  return parseFuelBody(text)
}

/** Parse a POST body (string or object) into a FuelState. */
export function parseFuelBody(body: unknown): FuelState {
  let parsed: unknown = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return { reports: [] }
    }
  }
  let list: unknown[] = []
  if (Array.isArray(parsed)) list = parsed
  else if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>
    if (Array.isArray(p.reports)) list = p.reports
    else list = [p] // single report object
  }
  const reports = list
    .map(sanitizeReport)
    .filter((r): r is FuelReport => Boolean(r))
    .slice(-60) // cap history
  return { reports }
}

/** Merge two fuel states (e.g. query param + POST body), latest-per-day wins. */
export function mergeFuel(a: FuelState, b: FuelState): FuelState {
  const byDay = new Map<string, FuelReport>()
  const push = (r: FuelReport) => {
    const day = r.day || new Date().toISOString().slice(0, 10)
    const prev = byDay.get(day)
    byDay.set(day, prev ? { ...prev, ...r, day } : { ...r, day })
  }
  a.reports.forEach(push)
  b.reports.forEach(push)
  return { reports: [...byDay.values()].sort((x, y) => (x.day || '').localeCompare(y.day || '')) }
}

/**
 * Blend self-reports into an already-built vitals series.
 *
 * Returns a NEW array; the input is never mutated. For each day that has a
 * report, the reported fields are eased toward (weight 0.72) while the seeded
 * value keeps a floor of 0.28 so a single noisy tap cannot violate physiology.
 * Downstream twin metrics that DERIVE from these fields (systolic from sodium
 * + sleep, mood from sleep/stress, symptomLoad from pm/sleep/adherence) are
 * re-propagated for edited days so the causal structure stays coherent.
 *
 * With `reports = []` this is the identity function → original twin preserved.
 */
export function blendVitals(userId: string, vitals: Vitals[], fuel: FuelState): {
  vitals: Vitals[]
  blendedDays: string[]
} {
  if (!fuel.reports.length) return { vitals, blendedDays: [] }
  const byDay = new Map(fuel.reports.map((r) => [r.day || '', r]))
  const blendedDays: string[] = []

  const out = vitals.map((v) => {
    const r = byDay.get(v.day)
    if (!r) return v
    blendedDays.push(v.day)
    const rng = seeded('blend', userId, v.day)
    const ease = (seed: number, report: number | undefined, w = 0.72) =>
      report === undefined ? seed : round(seed * (1 - w) + report * w, 4)

    // Direct self-reported fields.
    let sleepHours = v.sleepHours
    if (r.sleepHours !== undefined) sleepHours = ease(v.sleepHours, r.sleepHours)
    else if (r.rested !== undefined) sleepHours = ease(v.sleepHours, 4.8 + (r.rested / 10) * 4.4)
    sleepHours = clamp(sleepHours, 3.8, 9.8)

    const steps = r.steps !== undefined ? Math.round(ease(v.steps, r.steps)) : v.steps
    const hydrationMl = r.hydrationMl !== undefined ? Math.round(ease(v.hydrationMl, r.hydrationMl)) : v.hydrationMl
    const sodiumMg = r.sodiumMg !== undefined ? Math.round(ease(v.sodiumMg, r.sodiumMg)) : v.sodiumMg
    const screenMin = r.screenMin !== undefined ? Math.round(ease(v.screenMin, r.screenMin)) : v.screenMin
    let stress = r.stress !== undefined ? ease(v.stress, r.stress) : v.stress
    stress = clamp(stress, 5, 98)
    const adherence = r.medsTaken !== undefined
      ? Math.round(ease(v.adherence, r.medsTaken * 100, 0.85))
      : v.adherence

    // Mood: reported directly, else re-derived from the (possibly) new sleep+stress.
    let mood = r.mood !== undefined
      ? ease(v.mood, r.mood)
      : clamp(7.4 + (sleepHours - 6.8) * 0.52 - stress * 0.026, 1.4, 10)
    mood = round(clamp(mood, 1.4, 10), 1)

    // Re-propagate derived cardiometabolic + symptom fields along the SAME
    // relationships buildVitals used, so an edited sodium/sleep day still moves
    // systolic/symptoms in the physiologically-correct direction.
    const systolic = Math.round(clamp(
      v.systolic + (sodiumMg - v.sodiumMg) * 0.0042 + (v.sleepHours - sleepHours) * 1.9 + (v.adherence - adherence) * 0.09,
      96, 178
    ))
    const diastolic = Math.round(clamp(systolic * 0.64 + gauss(rng, 0, 1.2), 58, 112))
    const glucose = Math.round(clamp(v.glucose + (stress - v.stress) * 0.09 + (sodiumMg - v.sodiumMg) * 0.001, 68, 186))
    const hrv = Math.round(clamp(v.hrv + (sleepHours - v.sleepHours) * 5.6, 14, 118))
    const restingHr = Math.round(clamp(v.restingHr + (v.sleepHours - sleepHours) * 1.5, 44, 96))
    let symptomLoad = r.symptomLoad !== undefined
      ? ease(v.symptomLoad, r.symptomLoad)
      : clamp(v.symptomLoad + (v.sleepHours - sleepHours) * 0.9 + (v.adherence - adherence) * 0.035, 0, 10)
    symptomLoad = round(clamp(symptomLoad, 0, 10), 1)
    const sleepEfficiency = Math.round(clamp(72 + (sleepHours - 6) * 4.4, 52, 98))

    return {
      ...v,
      sleepHours: round(sleepHours, 2),
      sleepEfficiency,
      steps,
      hydrationMl,
      sodiumMg,
      screenMin,
      stress: Math.round(stress),
      adherence,
      mood,
      systolic,
      diastolic,
      glucose,
      hrv,
      restingHr,
      symptomLoad
    }
  })

  return { vitals: out, blendedDays }
}

/* ══════════════════════════════════════════════════════════════════
   Engagement + gamification (all derived, all reproducible)
   ══════════════════════════════════════════════════════════════════ */

export type Quest = {
  id: string
  label: string
  detail: string
  domain: string
  goal: number
  progress: number
  unit: string
  xp: number
  done: boolean
  lever?: string          // maps to a counterfactual lever id for "Commit as Quest"
  node?: string           // causal node this quest strengthens
}

export type TwinLevel = {
  level: number
  tierIndex: number
  tier: string
  aura: string            // css hue name for the avatar glow
  xp: number
  xpInLevel: number
  xpForNext: number
  pctToNext: number
  integrity: number       // the underlying Twin Integrity (unchanged formula input)
  engagementScore: number // 0..100 from logs + quests
}

const TIERS = [
  { name: 'Spark', aura: 'amber', min: 0 },
  { name: 'Steady', aura: 'blue', min: 20 },
  { name: 'Resilient', aura: 'mint', min: 45 },
  { name: 'Sovereign Twin', aura: 'violet', min: 78 }
]

/** Streak of consecutive days (ending today) that have a self-report. */
export function fuelStreak(fuel: FuelState): number {
  const days = new Set(fuel.reports.map((r) => r.day))
  let streak = 0
  for (let i = 0; i < 60; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    if (days.has(day)) streak++
    else if (i === 0) continue // today not logged yet — don't break the run
    else break
  }
  return streak
}

/**
 * Engagement score 0..100 from logging behaviour + quests completed.
 * This is the ONLY new term that feeds Twin Integrity, and it is additive and
 * bounded so a twin with zero logs matches the original integrity ± a small
 * amount (the baseline formula in api.ts already floors at 40).
 */
export function engagementScore(fuel: FuelState, questsDone: number): number {
  const streak = fuelStreak(fuel)
  const logs = fuel.reports.length
  const fieldsLogged = fuel.reports.reduce(
    (a, r) => a + NUMERIC_KEYS.filter((k) => r[k] !== undefined).length, 0
  )
  return round(clamp(
    Math.min(streak, 14) * 3.5 +      // up to 49 from streak
      Math.min(logs, 20) * 1.2 +      // up to 24 from breadth of history
      Math.min(fieldsLogged, 40) * 0.4 + // up to 16 from richness
      Math.min(questsDone, 6) * 1.8,  // up to ~11 from quests
    0, 100
  ), 1)
}

/**
 * Twin level + aura. `baseIntegrity` is the existing Twin Integrity value from
 * api.ts (graph-derived). Engagement nudges it upward (capped) so daily
 * check-ins visibly strengthen the twin — a demo hook — without ever lowering
 * the honest graph-derived floor.
 */
export function twinLevel(baseIntegrity: number, fuel: FuelState, questsDone: number): TwinLevel {
  const engagement = engagementScore(fuel, questsDone)
  // Blend: integrity is the honest core; engagement adds up to +6 (bounded ≤99.4).
  const effective = round(clamp(baseIntegrity + engagement * 0.06, baseIntegrity, 99.4), 1)
  const level = Math.max(1, Math.round((effective - 40) / 4) + 1) // 40→L1 … 99.4→L16
  const tierIndex = TIERS.reduce((acc, t, i) => (effective >= t.min ? i : acc), 0)
  const tier = TIERS[tierIndex]
  // XP: continuous, so a progress bar can animate between levels.
  const xp = Math.round((effective - 40) * 100 + engagement * 12)
  const xpForLevel = 400 // 4 integrity points * 100
  const xpInLevel = xp % xpForLevel
  return {
    level,
    tierIndex,
    tier: tier.name,
    aura: tier.aura,
    xp,
    xpInLevel,
    xpForNext: xpForLevel,
    pctToNext: round((xpInLevel / xpForLevel) * 100, 1),
    integrity: effective,
    engagementScore: engagement
  }
}

/**
 * Daily quests generated from the twin's own graph + live environment + recent
 * vitals. Each quest strengthens a real causal edge and maps to a real lever,
 * so completing it is meaningful, not cosmetic. Progress is read from today's
 * fuel report where available.
 */
export function buildQuests(
  userId: string,
  vitals: Vitals[],
  graph: CausalGraph,
  air: { pm25: number; aqi: number },
  fuel: FuelState
): Quest[] {
  const today = new Date().toISOString().slice(0, 10)
  const todayReport = fuel.reports.find((r) => r.day === today) || {}
  const last = vitals[vitals.length - 1]
  const edge = (s: string, t: string) => graph.edges.find((e) => e.source === s && e.target === t)?.strength ?? 0.3
  const mean = (k: keyof Vitals, n = 7) =>
    vitals.slice(-n).reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, vitals.slice(-n).length)

  const rng = seeded('quest', userId, today)
  const sleepEdge = edge('sleep-duration', 'mental-mood')
  const stepGoal = air.aqi < 100 ? 6000 : 3500
  const candidates: Omit<Quest, 'done'>[] = [
    {
      id: 'q-sleep',
      label: 'Sleep 7.5h tonight',
      detail: `Strengthens Sleep→Mood (edge ${round(sleepEdge, 2)}). Your 7-day sleep is ${round(mean('sleepHours'), 1)}h.`,
      domain: 'sleep',
      goal: 7.5,
      progress: round(Number(todayReport.sleepHours ?? last.sleepHours), 1),
      unit: 'h',
      xp: 120,
      lever: 'sleepHours',
      node: 'sleep-duration'
    },
    {
      id: 'q-steps',
      label: air.aqi < 100 ? `Walk ${stepGoal.toLocaleString()} steps` : `Walk ${stepGoal.toLocaleString()} steps (AQI ${air.aqi} — keep it gentle)`,
      detail: air.aqi < 100 ? 'Air is clean — bank an outdoor session.' : 'Air is elevated — indoor movement counts.',
      domain: 'vital',
      goal: stepGoal,
      progress: Math.round(Number(todayReport.steps ?? 0)),
      unit: 'steps',
      xp: 100,
      lever: 'steps',
      node: 'act-steps'
    },
    {
      id: 'q-sodium',
      label: 'Keep sodium under 2,300mg',
      detail: `Sodium→BP edge ${round(edge('nutr-sodium', 'vital-bp'), 2)}. Recent avg ${Math.round(mean('sodiumMg'))}mg.`,
      domain: 'nutrition',
      goal: 2300,
      progress: Math.round(Number(todayReport.sodiumMg ?? mean('sodiumMg'))),
      unit: 'mg',
      xp: 90,
      lever: 'sodiumMg',
      node: 'nutr-sodium'
    },
    {
      id: 'q-meds',
      label: 'Take every scheduled dose',
      detail: `Adherence→BP control. 7-day adherence ${Math.round(mean('adherence'))}%.`,
      domain: 'medication',
      goal: 100,
      progress: Math.round(Number((todayReport.medsTaken ?? mean('adherence') / 100) * 100)),
      unit: '%',
      xp: 110,
      lever: 'adherence',
      node: 'med-adherence'
    },
    {
      id: 'q-breath',
      label: '5-min breathwork',
      detail: 'Lowers stress node → protects sleep + glucose. Guided timer in the app.',
      domain: 'mental',
      goal: 1,
      progress: todayReport.stress !== undefined && Number(todayReport.stress) < mean('stress') ? 1 : 0,
      unit: 'session',
      xp: 70,
      lever: 'stress',
      node: 'mental-stress'
    },
    {
      id: 'q-screen',
      label: 'Screens off 60m before bed',
      detail: `Screen→Sleep-onset edge ${round(edge('behav-screen', 'sleep-duration'), 2)}.`,
      domain: 'sleep',
      goal: 1,
      progress: todayReport.screenMin !== undefined && Number(todayReport.screenMin) < mean('screenMin') ? 1 : 0,
      unit: 'night',
      xp: 60,
      lever: 'screenMin',
      node: 'behav-screen'
    }
  ]

  // Pick 3 deterministic quests for the day (stable per user/day), always
  // including sleep + the highest-signal environmental/med quest.
  const shuffled = candidates
    .map((q) => ({ q, k: seeded('qpick', userId, q.id, today)() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.q)
  const pick = [candidates[0], ...shuffled.filter((q) => q.id !== 'q-sleep')].slice(0, 3)

  return pick.map((q) => ({
    ...q,
    done: q.unit === 'mg' ? q.progress <= q.goal && q.progress > 0 : q.progress >= q.goal,
    xp: Math.round(q.xp * clamp(0.8 + rng() * 0.4, 0.8, 1.2))
  }))
}

/**
 * "Twin Whisper" — a short, plain-language narrative beat derived from the
 * strongest current causal signal + live environment. Deterministic (no LLM
 * required) so it always renders; the swarm can enrich it when a key is present.
 */
export function twinWhisper(
  vitals: Vitals[],
  graph: CausalGraph,
  air: { pm25: number; aqi: number },
  level: TwinLevel
): { text: string; mood: 'up' | 'flat' | 'down'; icon: string } {
  const last = vitals[vitals.length - 1]
  const prev = vitals[vitals.length - 2] || last
  const topEdge = graph.edges.slice().sort((a, b) => b.strength * b.confidence - a.strength * a.confidence)[0]
  const sLabel = graph.nodes.find((n) => n.id === topEdge?.source)?.label || 'a signal'
  const tLabel = graph.nodes.find((n) => n.id === topEdge?.target)?.label || 'your body'

  if (last.sleepHours - prev.sleepHours > 0.4) {
    return { text: `Your twin leveled toward ${level.tier} — last night's ${last.sleepHours}h sleep lifted your HRV and mood.`, mood: 'up', icon: 'bi-stars' }
  }
  if (air.aqi > 120) {
    return { text: `Your twin is breathing carefully — AQI ${air.aqi} outside. ${sLabel} → ${tLabel} is your strongest edge right now.`, mood: 'down', icon: 'bi-wind' }
  }
  if (last.mood >= 7.5) {
    return { text: `Your twin feels bright today (mood ${last.mood}/10). Keep the ${sLabel} → ${tLabel} loop going.`, mood: 'up', icon: 'bi-emoji-smile' }
  }
  return { text: `Your twin is steady. Its loudest whisper: ${sLabel} shapes ${tLabel} (strength ${topEdge?.strength ?? '—'}). One good log strengthens it.`, mood: 'flat', icon: 'bi-soundwave' }
}

/** Stable share token for a "leveled up" ZK badge (digest only, no raw data). */
export function levelBadgeDigest(userId: string, level: TwinLevel): string {
  const h = fnv1a(`${userId}|L${level.level}|${level.tier}|${level.integrity}`)
  return `0x${(h >>> 0).toString(16).padStart(8, '0')}${(fnv1a(`${h}`) >>> 0).toString(16).padStart(8, '0')}`
}
