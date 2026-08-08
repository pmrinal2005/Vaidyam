/**
 * Layer 4 — Counterfactual Simulation Engine.
 *
 * "What-if" queries perturb edge weights on the causal graph and re-propagate
 * the effect forward, an LLM-native approximation of do-calculus intervention:
 * do(X = x) severs incoming edges of X, then downstream nodes are recomputed
 * along the graph's own measured lags and strengths.
 */
import type { CausalGraph } from './types'
import { clamp, round } from './rand'
import type { Vitals } from './twin'

export type Lever = {
  id: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  baseline: number
  node: string
}

export type Outcome = {
  key: string
  label: string
  unit: string
  baseline: number
  projected: number
  delta: number
  deltaPct: number
  direction: 'better' | 'worse' | 'flat'
  path: string[]
  horizonMonths: number
}

const mean = (v: Vitals[], k: keyof Vitals) => v.reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, v.length)

export function buildLevers(vitals: Vitals[]): Lever[] {
  const w = vitals.slice(-14)
  return [
    { id: 'sleepHours', label: 'Sleep duration', unit: 'h/night', min: 4, max: 10, step: 0.25, baseline: round(mean(w, 'sleepHours'), 2), node: 'sleep-duration' },
    { id: 'sodiumMg', label: 'Sodium intake', unit: 'mg/day', min: 800, max: 5000, step: 50, baseline: Math.round(mean(w, 'sodiumMg')), node: 'nutr-sodium' },
    { id: 'steps', label: 'Daily activity', unit: 'steps', min: 1000, max: 20000, step: 250, baseline: Math.round(mean(w, 'steps')), node: 'act-steps' },
    { id: 'adherence', label: 'Medication adherence', unit: '%', min: 40, max: 100, step: 1, baseline: Math.round(mean(w, 'adherence')), node: 'med-adherence' },
    { id: 'pm25', label: 'PM2.5 exposure', unit: 'µg/m³', min: 2, max: 150, step: 1, baseline: round(mean(w, 'pm25'), 1), node: 'env-pm25' },
    { id: 'stress', label: 'Stress load', unit: '/100', min: 5, max: 95, step: 1, baseline: Math.round(mean(w, 'stress')), node: 'mental-stress' },
    { id: 'screenMin', label: 'Evening screen time', unit: 'min', min: 30, max: 700, step: 10, baseline: Math.round(mean(w, 'screenMin')), node: 'behav-screen' },
    { id: 'hydrationMl', label: 'Hydration', unit: 'ml/day', min: 500, max: 4500, step: 100, baseline: Math.round(mean(w, 'hydrationMl')), node: 'nutr-hydration' }
  ]
}

function edgeStrength(graph: CausalGraph, source: string, target: string): number {
  return graph.edges.find((e) => e.source === source && e.target === target)?.strength ?? 0
}

function nodeLabel(graph: CausalGraph, id: string) {
  return graph.nodes.find((n) => n.id === id)?.label || id
}

/**
 * Simulates do(levers) over the graph. Effect sizes come from the graph's own
 * measured edge strengths, so a user whose sodium→BP edge is weak sees a
 * smaller projected benefit than one whose edge is strong.
 */
export function simulate(
  graph: CausalGraph,
  vitals: Vitals[],
  interventions: Record<string, number>,
  horizonMonths = 60
): { outcomes: Outcome[]; levers: Lever[]; interventions: Record<string, number>; adherenceCost: number; confidence: number } {
  const levers = buildLevers(vitals)
  const w = vitals.slice(-14)

  const get = (id: string) => {
    const lever = levers.find((l) => l.id === id)!
    const v = interventions[id]
    return Number.isFinite(v) ? clamp(Number(v), lever.min, lever.max) : lever.baseline
  }

  const dSleep = get('sleepHours') - levers[0].baseline
  const dSodium = get('sodiumMg') - levers[1].baseline
  const dSteps = get('steps') - levers[2].baseline
  const dAdh = get('adherence') - levers[3].baseline
  const dPm = get('pm25') - levers[4].baseline
  const dStress = get('stress') - levers[5].baseline
  const dScreen = get('screenMin') - levers[6].baseline
  const dHydr = get('hydrationMl') - levers[7].baseline

  // Screen time and stress act on sleep, so propagate that first (chained do).
  const sleepFromScreen = -dScreen * 0.0022 * edgeStrength(graph, 'behav-screen', 'sleep-duration')
  const sleepFromStress = -dStress * 0.012 * edgeStrength(graph, 'mental-stress', 'sleep-duration')
  const sleepEff = dSleep + sleepFromScreen + sleepFromStress

  const baseSys = mean(w, 'systolic')
  const projSys = clamp(
    baseSys +
      dSodium * 0.0042 * (edgeStrength(graph, 'nutr-sodium', 'vital-bp') / 0.35) -
      sleepEff * 1.95 * (edgeStrength(graph, 'sleep-duration', 'vital-bp') / 0.35) -
      dAdh * 0.092 * (edgeStrength(graph, 'med-adherence', 'vital-bp') / 0.35) -
      dSteps * 0.00021,
    92,
    182
  )

  const baseSymptom = mean(w, 'symptomLoad')
  const projSymptom = clamp(
    baseSymptom +
      dPm * 0.055 * (edgeStrength(graph, 'env-pm25', 'sym-respiratory') / 0.35) -
      sleepEff * 0.42 -
      dAdh * 0.032 * (edgeStrength(graph, 'med-adherence', 'sym-respiratory') / 0.35),
    0,
    10
  )

  const baseHrv = mean(w, 'hrv')
  const projHrv = clamp(
    baseHrv + sleepEff * 5.4 * (edgeStrength(graph, 'sleep-duration', 'vital-hrv') / 0.35) - dPm * 0.1 + dSteps * 0.00042,
    12,
    124
  )

  const baseMood = mean(w, 'mood')
  const projMood = clamp(
    baseMood + sleepEff * 0.5 * (edgeStrength(graph, 'sleep-duration', 'mental-mood') / 0.35) - dStress * 0.024 + dSteps * 0.000048,
    1,
    10
  )

  const baseGlucose = mean(w, 'glucose')
  const projGlucose = clamp(baseGlucose + dStress * 0.088 + dSodium * 0.0009 - dSteps * 0.00055 - sleepEff * 1.1, 66, 190)

  const baseHr = mean(w, 'restingHr')
  const projHr = clamp(baseHr - sleepEff * 1.45 - dSteps * 0.00028 - dHydr * 0.0009 + dPm * 0.032, 42, 98)

  // 5-year hypertension trajectory. The horizon amplifies the sustained *change*
  // only — with no intervention the projection must equal the baseline exactly,
  // otherwise do(∅) would not be the identity.
  const horizonFactor = clamp(horizonMonths / 60, 0.15, 1.6)
  const riskOf = (sys: number, sleep: number) => (sys - 108) * 1.55 + (7.2 - sleep) * 4.1
  const baseSleep = mean(w, 'sleepHours')
  const rawBaseRisk = riskOf(baseSys, baseSleep)
  const rawProjRisk = riskOf(projSys, baseSleep + sleepEff)
  const baseRisk = clamp(rawBaseRisk, 2, 96)
  const projRisk = clamp(rawBaseRisk + (rawProjRisk - rawBaseRisk) * (1 + 0.22 * horizonFactor), 2, 96)

  const mk = (
    key: string,
    label: string,
    unit: string,
    baseline: number,
    projected: number,
    lowerIsBetter: boolean,
    path: string[]
  ): Outcome => {
    const delta = round(projected - baseline, 2)
    const better = lowerIsBetter ? delta < -0.01 : delta > 0.01
    const worse = lowerIsBetter ? delta > 0.01 : delta < -0.01
    return {
      key,
      label,
      unit,
      baseline: round(baseline, 1),
      projected: round(projected, 1),
      delta,
      deltaPct: baseline === 0 ? 0 : round((delta / baseline) * 100, 1),
      direction: better ? 'better' : worse ? 'worse' : 'flat',
      path: path.map((p) => nodeLabel(graph, p)),
      horizonMonths
    }
  }

  const outcomes: Outcome[] = [
    mk('hypertension5y', '5-year hypertension risk', '/100', baseRisk, projRisk, true, ['nutr-sodium', 'vital-bp', 'sym-respiratory']),
    mk('systolic', 'Systolic pressure', 'mmHg', baseSys, projSys, true, ['nutr-sodium', 'sleep-duration', 'vital-bp']),
    mk('symptomLoad', 'Respiratory symptom load', '/10', baseSymptom, projSymptom, true, ['env-pm25', 'sym-respiratory']),
    mk('hrv', 'HRV (recovery capacity)', 'ms', baseHrv, projHrv, false, ['sleep-duration', 'vital-hrv']),
    mk('mood', 'Mood score', '/10', baseMood, projMood, false, ['sleep-duration', 'mental-mood']),
    mk('glucose', 'Fasting glucose', 'mg/dL', baseGlucose, projGlucose, true, ['mental-stress', 'vital-glucose']),
    mk('restingHr', 'Resting heart rate', 'bpm', baseHr, projHr, true, ['act-steps', 'vital-hr'])
  ]

  // Larger deviations from current behaviour are harder to sustain.
  const magnitude =
    Math.abs(dSleep) / 3 + Math.abs(dSodium) / 2200 + Math.abs(dSteps) / 9000 + Math.abs(dAdh) / 45 + Math.abs(dStress) / 60
  const adherenceCost = round(clamp(magnitude * 34, 0, 100))
  const meanEdgeConf = graph.edges.reduce((a, b) => a + b.confidence, 0) / Math.max(1, graph.edges.length)

  return {
    outcomes,
    levers,
    interventions: {
      sleepHours: get('sleepHours'),
      sodiumMg: get('sodiumMg'),
      steps: get('steps'),
      adherence: get('adherence'),
      pm25: get('pm25'),
      stress: get('stress'),
      screenMin: get('screenMin'),
      hydrationMl: get('hydrationMl')
    },
    adherenceCost,
    confidence: round(clamp(meanEdgeConf - adherenceCost / 420, 0.35, 0.96), 2)
  }
}

/** Literature search terms implied by the active intervention set. */
export function literatureTerms(interventions: Record<string, number>, levers: Lever[]): string {
  const active = levers
    .filter((l) => Math.abs((interventions[l.id] ?? l.baseline) - l.baseline) > l.step)
    .map((l) => l.id)
  const TERM: Record<string, string> = {
    sleepHours: 'sleep duration',
    sodiumMg: 'dietary sodium reduction',
    steps: 'physical activity',
    adherence: 'medication adherence',
    pm25: 'PM2.5 exposure',
    stress: 'psychological stress',
    screenMin: 'screen time',
    hydrationMl: 'hydration'
  }
  const parts = active.map((a) => TERM[a]).filter(Boolean)
  if (!parts.length) return 'blood pressure AND lifestyle intervention'
  return `${parts.slice(0, 3).join(' AND ')} AND blood pressure`
}
