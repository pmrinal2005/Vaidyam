/**
 * Layer 5 — Privacy & Verifiability.
 *
 * zk attestations: a deterministic computation over the private series is
 * compiled into a claim, and only the claim + a commitment/proof digest leave
 * the twin. The raw series never crosses the boundary (EZKL / RISC Zero style
 * public-output-plus-proof shape).
 *
 * DP aggregation: Opacus-style Gaussian/Laplace noise applied locally per user
 * before a Flower-style aggregation job combines contributions.
 */
import { sha256, seeded, gauss, clamp, round } from './rand'
import type { Vitals } from './twin'

export type Attestation = {
  id: string
  claim: string
  statement: string
  publicOutput: Record<string, string | number | boolean>
  satisfied: boolean
  circuit: string
  constraints: number
  proofSystem: string
  proveMs: number
  verifyMs: number
  proofSizeBytes: number
  commitment: string
  proofDigest: string
  witnessFieldsHidden: string[]
  issuedAt: string
  expiresAt: string
  verifierUrl: string
}

type ClaimDef = {
  id: string
  claim: string
  circuit: string
  compute: (v: Vitals[]) => { value: number; threshold: number; satisfied: boolean; unit: string; statement: string; hidden: string[] }
}

const mean = (v: Vitals[], k: keyof Vitals) => v.reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, v.length)

export const CLAIM_DEFS: ClaimDef[] = [
  {
    id: 'adherence-90',
    claim: 'adherence_ge_90_over_90d',
    circuit: 'mean_threshold.ezkl',
    compute: (v) => {
      const value = round(mean(v, 'adherence'), 1)
      return {
        value,
        threshold: 90,
        satisfied: value >= 90,
        unit: '%',
        statement: 'Medication adherence ≥ 90% across the attestation window',
        hidden: ['per-dose timestamps', 'drug identities', 'refill records', 'pharmacy']
      }
    }
  },
  {
    id: 'bp-controlled',
    claim: 'systolic_bp_lt_140_p95',
    circuit: 'percentile_bound.ezkl',
    compute: (v) => {
      const sorted = v.map((x) => x.systolic).sort((a, b) => a - b)
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]
      return {
        value: p95,
        threshold: 140,
        satisfied: p95 < 140,
        unit: 'mmHg',
        statement: '95th-percentile systolic pressure below 140 mmHg',
        hidden: ['individual readings', 'measurement times', 'diastolic series']
      }
    }
  },
  {
    id: 'activity-floor',
    claim: 'mean_steps_ge_7000',
    circuit: 'mean_threshold.ezkl',
    compute: (v) => {
      const value = Math.round(mean(v, 'steps'))
      return {
        value,
        threshold: 7000,
        satisfied: value >= 7000,
        unit: 'steps/day',
        statement: 'Mean daily activity at or above the 7,000-step wellness floor',
        hidden: ['GPS traces', 'per-hour movement', 'workout types']
      }
    }
  },
  {
    id: 'sleep-floor',
    claim: 'mean_sleep_ge_6_5h',
    circuit: 'mean_threshold.ezkl',
    compute: (v) => {
      const value = round(mean(v, 'sleepHours'), 2)
      return {
        value,
        threshold: 6.5,
        satisfied: value >= 6.5,
        unit: 'h/night',
        statement: 'Mean sleep duration at or above 6.5 hours per night',
        hidden: ['sleep/wake timestamps', 'stage architecture', 'bedroom sensor data']
      }
    }
  },
  {
    id: 'no-severe-events',
    claim: 'zero_severe_symptom_days',
    circuit: 'range_proof.risc0',
    compute: (v) => {
      const severe = v.filter((x) => x.symptomLoad >= 7).length
      return {
        value: severe,
        threshold: 0,
        satisfied: severe === 0,
        unit: 'days',
        statement: 'No severe symptom days (load ≥ 7/10) in the attestation window',
        hidden: ['symptom descriptions', 'diagnoses', 'clinical notes']
      }
    }
  },
  {
    id: 'risk-band',
    claim: 'cardio_risk_score_lt_40',
    circuit: 'model_inference.ezkl',
    compute: (v) => {
      const sys = mean(v, 'systolic')
      const score = Math.round(clamp((sys - 108) * 1.55 + (7.2 - mean(v, 'sleepHours')) * 4.1, 2, 96))
      return {
        value: score,
        threshold: 40,
        satisfied: score < 40,
        unit: '/100',
        statement: 'Model-derived cardiometabolic risk score below the 40/100 underwriting band',
        hidden: ['model input vector', 'full vitals series', 'graph edge weights']
      }
    }
  }
]

export async function buildAttestation(
  def: ClaimDef,
  vitals: Vitals[],
  userId: string,
  windowDays: number,
  origin: string
): Promise<Attestation> {
  const slice = vitals.slice(-windowDays)
  const r = def.compute(slice)
  const rng = seeded('zk', userId, def.id, slice.length)

  // Commitment binds the private witness; the digest stands in for the proof
  // bytes a real EZKL/RISC Zero prover would emit.
  const commitment = await sha256(`${userId}|${def.id}|${slice.map((v) => v.day).join(',')}|witness`)
  const proofDigest = await sha256(`${commitment}|${r.value}|${r.threshold}|${r.satisfied}`)

  const constraints = Math.round(clamp(gauss(rng, def.circuit.includes('risc0') ? 148000 : 46000, 9000), 12000, 260000))
  const now = new Date()
  const expires = new Date(now.getTime() + 30 * 86400000)

  return {
    id: `att_${proofDigest.slice(0, 16)}`,
    claim: def.claim,
    statement: r.statement,
    publicOutput: {
      claim: def.claim,
      threshold: r.threshold,
      unit: r.unit,
      window_days: windowDays,
      satisfied: r.satisfied
    },
    satisfied: r.satisfied,
    circuit: def.circuit,
    constraints,
    proofSystem: def.circuit.includes('risc0') ? 'RISC Zero zkVM (STARK→SNARK)' : 'EZKL (Halo2 KZG)',
    proveMs: Math.round(clamp(gauss(rng, constraints / 62, 380), 420, 9000)),
    verifyMs: Math.round(clamp(gauss(rng, 9, 3), 3, 30)),
    proofSizeBytes: Math.round(clamp(gauss(rng, def.circuit.includes('risc0') ? 217000 : 1248, 160), 640, 400000)),
    commitment: `0x${commitment.slice(0, 48)}`,
    proofDigest: `0x${proofDigest}`,
    witnessFieldsHidden: r.hidden,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    verifierUrl: `${origin}/api/zk/verify?id=att_${proofDigest.slice(0, 16)}`
  }
}

/* ── Differentially-private federated aggregation ── */
export type DpMetric = {
  key: string
  label: string
  unit: string
  trueLocal: number
  noised: number
  epsilon: number
  delta: number
  sensitivity: number
  sigma: number
  cohortSize: number
  kAnonymous: boolean
}

export function dpAggregate(
  vitals: Vitals[],
  userId: string,
  epsilon = 1.0,
  cohortSize = 1284
): { metrics: DpMetric[]; budget: { epsilon: number; delta: number; spent: number; remaining: number; mechanism: string; clipping: number } } {
  const rng = seeded('dp', userId, epsilon)
  const delta = 1e-5
  const specs: { key: string; label: string; unit: string; field: keyof Vitals; sensitivity: number }[] = [
    { key: 'pm25', label: 'Mean PM2.5 exposure', unit: 'µg/m³', field: 'pm25', sensitivity: 8 },
    { key: 'sleep', label: 'Mean sleep duration', unit: 'h', field: 'sleepHours', sensitivity: 0.5 },
    { key: 'adherence', label: 'Mean adherence', unit: '%', field: 'adherence', sensitivity: 4 },
    { key: 'symptom', label: 'Mean symptom load', unit: '/10', field: 'symptomLoad', sensitivity: 0.6 },
    { key: 'systolic', label: 'Mean systolic BP', unit: 'mmHg', field: 'systolic', sensitivity: 5 },
    { key: 'steps', label: 'Mean daily steps', unit: 'steps', field: 'steps', sensitivity: 900 }
  ]

  const metrics = specs.map((s) => {
    const trueLocal = round(mean(vitals, s.field), 2)
    // Gaussian mechanism: σ = sensitivity·√(2·ln(1.25/δ))/ε
    const sigma = (s.sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon
    const noised = round(trueLocal + gauss(rng, 0, sigma / Math.sqrt(cohortSize)), 2)
    return {
      key: s.key,
      label: s.label,
      unit: s.unit,
      trueLocal,
      noised,
      epsilon,
      delta,
      sensitivity: s.sensitivity,
      sigma: round(sigma, 2),
      cohortSize,
      kAnonymous: cohortSize >= 50
    }
  })

  return {
    metrics,
    budget: {
      epsilon,
      delta,
      spent: round(epsilon * specs.length * 0.1, 3),
      remaining: round(Math.max(0, 8 - epsilon * specs.length * 0.1), 3),
      mechanism: 'Gaussian (Opacus-style per-sample clipping)',
      clipping: 1.0
    }
  }
}

/* ── Vector memory compression (binary + int8 two-stage index) ── */
export type QuantStats = {
  dim: number
  vectors: number
  float32Bytes: number
  int8Bytes: number
  binaryBytes: number
  compressionBinary: number
  compressionInt8: number
  recallBinary: number
  recallRescored: number
  speedupBinary: number
  matryoshkaDims: { dim: number; recall: number; bytes: number }[]
  freeTierCapMb: number
  usedMb: number
}

export function quantizationStats(vectorCount: number, dim = 384): QuantStats {
  const f32 = vectorCount * dim * 4
  const int8 = vectorCount * dim
  const bin = Math.ceil((vectorCount * dim) / 8)
  const matryoshkaDims = [384, 256, 192, 128, 96, 64].map((d) => ({
    dim: d,
    // Leading-dimension truncation preserves most retrieval quality.
    recall: round(clamp(0.985 - Math.pow((384 - d) / 384, 1.55) * 0.19, 0.6, 0.99), 3),
    bytes: Math.ceil((vectorCount * d) / 8)
  }))
  return {
    dim,
    vectors: vectorCount,
    float32Bytes: f32,
    int8Bytes: int8,
    binaryBytes: bin,
    compressionBinary: 32,
    compressionInt8: 4,
    recallBinary: 0.92,
    recallRescored: 0.983,
    speedupBinary: 40,
    matryoshkaDims,
    freeTierCapMb: 500,
    usedMb: round((bin + int8) / (1024 * 1024), 3)
  }
}
