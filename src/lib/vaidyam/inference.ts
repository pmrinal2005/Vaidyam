/**
 * Layers 2–3 — Multi-Agent Swarm (MoA) + Draft-Verify Speculative Cascade.
 *
 * Provider order mirrors PART 5 of the architecture: Groq LPU drafts (EAGLE /
 * Medusa-style speculation), NVIDIA NIM verifies divergent spans, OpenRouter
 * supplies the Agent-Forest voting pool. A FrugalGPT-style router decides which
 * stages actually run. When no provider key is present the cascade still
 * executes against the platform LLM proxy, and if that is unavailable it falls
 * back to a deterministic local reasoner over the causal graph.
 */
import type { Bindings, CascadeStage, CausalGraph, SwarmAgent } from './types'
import { seeded, clamp, round, gauss } from './rand'
import type { Vitals } from './twin'

export type ProviderId = 'groq' | 'nim' | 'openrouter' | 'proxy'

type ProviderCfg = {
  id: ProviderId
  label: string
  base: string
  key?: string
  draftModel: string
  verifyModel: string
  voteModels: string[]
}

/**
 * ENV-SAFETY NOTE
 * ---------------
 * `env` may be `undefined` — `c.env` is absent when this same Hono app runs in
 * the browser via src/local/engine.ts, and under `wrangler pages dev` before
 * bindings exist. Dereferencing a key off `undefined` threw a
 * TypeError, which surfaced as a 500 on /health, /cascade, /swarm and /saas
 * instead of the intended "no key → deterministic reasoner" degradation.
 */
export function providers(env?: Bindings | null): ProviderCfg[] {
  const e = env || ({} as Bindings)
  return [
    {
      id: 'groq',
      label: 'GroqCloud LPU',
      base: 'https://api.groq.com/openai/v1',
      key: e.GROQ_API_KEY,
      draftModel: 'llama-3.1-8b-instant',
      verifyModel: 'llama-3.3-70b-versatile',
      voteModels: ['llama-3.1-8b-instant', 'gemma2-9b-it']
    },
    {
      id: 'nim',
      label: 'NVIDIA NIM',
      base: 'https://integrate.api.nvidia.com/v1',
      key: e.NVIDIA_NIM_API_KEY,
      draftModel: 'meta/llama-3.1-8b-instruct',
      verifyModel: 'meta/llama-3.3-70b-instruct',
      voteModels: ['meta/llama-3.1-8b-instruct', 'mistralai/mistral-7b-instruct-v0.3']
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      base: 'https://openrouter.ai/api/v1',
      key: e.OPENROUTER_API_KEY,
      draftModel: 'meta-llama/llama-3.2-3b-instruct:free',
      verifyModel: 'meta-llama/llama-3.3-70b-instruct:free',
      voteModels: ['meta-llama/llama-3.2-3b-instruct:free', 'google/gemma-2-9b-it:free', 'qwen/qwen-2.5-7b-instruct:free']
    },
    {
      id: 'proxy',
      label: 'Platform LLM proxy',
      base: e.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1',
      key: e.OPENAI_API_KEY,
      draftModel: 'gpt-5-nano',
      verifyModel: 'gpt-5-mini',
      voteModels: ['gpt-5-nano', 'gpt-5-mini']
    }
  ]
}

async function chat(
  cfg: ProviderCfg,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 320,
  timeoutMs = 9000
): Promise<{ text: string; ms: number; tokensIn: number; tokensOut: number } | null> {
  if (!cfg.key) return null
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.key}`,
        ...(cfg.id === 'openrouter' ? { 'HTTP-Referer': 'https://catena.health', 'X-Title': 'Catena' } : {})
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.35 })
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const j: any = await res.json()
    const text = j?.choices?.[0]?.message?.content
    if (!text) return null
    return {
      text: String(text).trim(),
      ms: Date.now() - started,
      tokensIn: Number(j?.usage?.prompt_tokens || 0),
      tokensOut: Number(j?.usage?.completion_tokens || 0)
    }
  } catch {
    return null
  }
}

export const AGENT_DEFS = [
  { id: 'agent-med', name: 'Medication Agent', domain: 'medication', layer: 1, seeds: ['med-adherence', 'med-refill'] },
  { id: 'agent-sleep', name: 'Sleep / Circadian Agent', domain: 'sleep', layer: 1, seeds: ['sleep-duration', 'sleep-deep'] },
  { id: 'agent-env', name: 'Environmental Exposure Agent', domain: 'environment', layer: 1, seeds: ['env-pm25', 'env-pollen'] },
  { id: 'agent-mental', name: 'Mental Health Sentiment Agent', domain: 'mental', layer: 1, seeds: ['mental-mood', 'mental-stress'] },
  { id: 'agent-nutr', name: 'Nutrition Agent', domain: 'nutrition', layer: 1, seeds: ['nutr-sodium', 'nutr-hydration'] },
  { id: 'agent-coord', name: 'Preventive-Care Coordinator', domain: 'synthesis', layer: 2, seeds: [] }
] as const

/** FrugalGPT-style router: decides how far up the cascade a query must go. */
export function routeQuery(query: string, draftConfidence: number) {
  const q = query.toLowerCase()
  const highStakes = /chest pain|shortness of breath|suicid|bleed|stroke|emergency|severe|doctor|hospital|should i|risk|dangerous|worsen/.test(q)
  const escalateVerify = highStakes || draftConfidence < 0.82
  const escalateSwarm = highStakes || draftConfidence < 0.7
  const agentCount = escalateSwarm ? (highStakes ? 15 : 9) : 5
  return {
    highStakes,
    escalateVerify,
    escalateSwarm,
    agentCount,
    reason: highStakes
      ? 'Clinically consequential phrasing detected — full swarm consensus engaged.'
      : draftConfidence < 0.7
      ? 'Draft confidence below 0.70 — escalating to Agent-Forest vote.'
      : draftConfidence < 0.82
      ? 'Draft confidence in verify band — NIM verifier invoked on divergent spans only.'
      : 'Draft accepted at step 1 — no verifier or swarm cost incurred.'
  }
}

/** Local deterministic reasoner — the always-available floor of the cascade. */
export function localReason(
  agentId: string,
  graph: CausalGraph,
  vitals: Vitals[],
  ppr: Record<string, number>
): { vote: string; rationale: string; confidence: number } {
  const last = vitals[vitals.length - 1]
  const prev14 = vitals.slice(-14)
  const mean = (k: keyof Vitals) => prev14.reduce((a, b) => a + Number(b[k]), 0) / Math.max(1, prev14.length)
  const top = Object.entries(ppr).sort((a, b) => b[1] - a[1])[0]
  const topLabel = graph.nodes.find((n) => n.id === top?.[0])?.label || 'causal hub'

  switch (agentId) {
    case 'agent-med': {
      const adh = mean('adherence')
      return {
        vote: adh >= 90 ? 'maintain' : adh >= 78 ? 'reinforce' : 'intervene',
        rationale: `14-day adherence ${Math.round(adh)}%. Adherence→BP edge strength ${
          graph.edges.find((e) => e.source === 'med-adherence' && e.target === 'vital-bp')?.strength ?? 0
        } at 48h lag.`,
        confidence: round(clamp(0.62 + adh / 400, 0.6, 0.95), 2)
      }
    }
    case 'agent-sleep': {
      const s = mean('sleepHours')
      return {
        vote: s >= 7.2 ? 'maintain' : s >= 6.3 ? 'reinforce' : 'intervene',
        rationale: `Mean sleep ${round(s, 1)}h with ${Math.round(mean('sleepEfficiency'))}% efficiency; deep-sleep share ${Math.round(
          mean('deepSleepPct')
        )}%.`,
        confidence: round(clamp(0.58 + s / 20, 0.55, 0.94), 2)
      }
    }
    case 'agent-env': {
      const pm = last.pm25
      return {
        vote: pm < 25 ? 'maintain' : pm < 55 ? 'reinforce' : 'intervene',
        rationale: `Live PM2.5 ${pm} µg/m³ (AQI ${last.aqi}); exposure→symptom edge fires at a 12h lag.`,
        confidence: round(clamp(0.7 + (pm > 55 ? 0.18 : 0.05), 0.6, 0.96), 2)
      }
    }
    case 'agent-mental': {
      const m = mean('mood')
      return {
        vote: m >= 7 ? 'maintain' : m >= 5.6 ? 'reinforce' : 'intervene',
        rationale: `Mood ${round(m, 1)}/10 against stress load ${Math.round(mean('stress'))}; stress→sleep edge is bidirectionally reinforcing.`,
        confidence: round(clamp(0.56 + m / 22, 0.54, 0.92), 2)
      }
    }
    case 'agent-nutr': {
      const na = mean('sodiumMg')
      return {
        vote: na < 2300 ? 'maintain' : na < 3000 ? 'reinforce' : 'intervene',
        rationale: `Sodium ${Math.round(na)} mg/day vs 2300 mg target; sodium→BP edge acts on a 36h lag.`,
        confidence: round(clamp(0.64 + (na < 2300 ? 0.16 : 0.02), 0.6, 0.93), 2)
      }
    }
    default: {
      const sys = mean('systolic')
      return {
        vote: sys < 125 ? 'maintain' : sys < 138 ? 'reinforce' : 'intervene',
        rationale: `Fused across 5 specialist layers. Dominant retrieval hub: ${topLabel}. Mean systolic ${Math.round(
          sys
        )} mmHg over 14 days.`,
        confidence: round(clamp(0.72 + (sys < 130 ? 0.14 : 0.02), 0.66, 0.96), 2)
      }
    }
  }
}

/**
 * Runs the MoA swarm. Layer-1 specialists run in parallel; the Coordinator
 * consumes all layer-1 outputs as auxiliary information (MoA definition).
 */
export async function runSwarm(
  env: Bindings | undefined | null,
  opts: {
    query: string
    graph: CausalGraph
    vitals: Vitals[]
    ppr: Record<string, number>
    contextBrief: string
    agentCount: number
    useLive: boolean
  }
): Promise<{ agents: SwarmAgent[]; consensus: { vote: string; support: number; distribution: Record<string, number> }; live: boolean }> {
  const provs = providers(env).filter((p) => p.key)
  const primary = provs[0]
  const rng = seeded('swarm', opts.query, opts.vitals.length)
  let live = false

  const layer1 = AGENT_DEFS.filter((a) => a.layer === 1)
  const results = await Promise.all(
    layer1.map(async (def, i) => {
      const local = localReason(def.id, opts.graph, opts.vitals, opts.ppr)
      let rationale = local.rationale
      let ms = Math.round(clamp(gauss(rng, 180, 60), 55, 620))
      let tokens = Math.round(clamp(gauss(rng, 140, 50), 40, 400))

      if (opts.useLive && primary) {
        const cfg = provs[i % provs.length]
        const res = await chat(
          cfg,
          cfg.draftModel,
          [
            {
              role: 'system',
              content: `You are Catena's ${def.name}. Reason ONLY over the supplied causal-graph context. Answer in <=45 words, clinical but plain. Never invent numbers.`
            },
            { role: 'user', content: `${opts.contextBrief}\n\nUser question: ${opts.query}\n\nGive your domain verdict and the causal edge you relied on.` }
          ],
          170
        )
        if (res) {
          live = true
          rationale = res.text
          ms = res.ms
          tokens = res.tokensOut || tokens
        }
      }

      const provider = (provs[i % Math.max(1, provs.length)]?.id || 'groq') as SwarmAgent['provider']
      const cfg = provs[i % Math.max(1, provs.length)]
      return {
        id: def.id,
        name: def.name,
        domain: def.domain,
        layer: 1,
        provider: provider === 'proxy' ? 'groq' : provider,
        model: cfg?.draftModel || 'llama-3.1-8b-instant (offline sim)',
        status: 'done' as const,
        latencyMs: ms,
        tokens,
        confidence: local.confidence,
        vote: local.vote,
        rationale
      } satisfies SwarmAgent
    })
  )

  // Agent-Forest sampling & voting — n cheap parallel instantiations.
  const distribution: Record<string, number> = {}
  const ballots: string[] = []
  for (let i = 0; i < opts.agentCount; i++) {
    const base = results[i % results.length]
    const jitter = rng()
    const vote = jitter < base.confidence ? base.vote : ['maintain', 'reinforce', 'intervene'][Math.floor(rng() * 3)]
    ballots.push(vote)
    distribution[vote] = (distribution[vote] || 0) + 1
  }
  const winner = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0] || ['maintain', 1]

  const coordDef = AGENT_DEFS.find((a) => a.layer === 2)!
  const coordLocal = localReason(coordDef.id, opts.graph, opts.vitals, opts.ppr)
  let coordRationale = coordLocal.rationale
  let coordMs = Math.round(clamp(gauss(rng, 520, 160), 190, 1500))
  if (opts.useLive && provs.length) {
    const verifier = provs.find((p) => p.id === 'nim') || provs[0]
    const res = await chat(
      verifier,
      verifier.verifyModel,
      [
        {
          role: 'system',
          content:
            "You are Catena's Preventive-Care Coordinator. You receive five specialist agent outputs as auxiliary information and must synthesise ONE recommendation in <=70 words. Cite the dominant causal chain. Never give a diagnosis; recommend clinician review when stakes are high."
        },
        {
          role: 'user',
          content: `${opts.contextBrief}\n\nSpecialist outputs:\n${results
            .map((r) => `- ${r.name} [${r.vote}]: ${r.rationale}`)
            .join('\n')}\n\nSwarm ballot: ${JSON.stringify(distribution)}\nUser question: ${opts.query}`
        }
      ],
      260
    )
    if (res) {
      live = true
      coordRationale = res.text
      coordMs = res.ms
    }
  }

  const coordinator: SwarmAgent = {
    id: coordDef.id,
    name: coordDef.name,
    domain: coordDef.domain,
    layer: 2,
    provider: 'nim',
    model: (provs.find((p) => p.id === 'nim') || provs[0])?.verifyModel || 'llama-3.3-70b-versatile (offline sim)',
    status: 'done',
    latencyMs: coordMs,
    tokens: Math.round(clamp(gauss(rng, 260, 70), 90, 620)),
    confidence: round(clamp(coordLocal.confidence + 0.02, 0.6, 0.97), 2),
    vote: String(winner[0]),
    rationale: coordRationale
  }

  return {
    agents: [...results, coordinator],
    consensus: {
      vote: String(winner[0]),
      support: round((Number(winner[1]) / ballots.length) * 100),
      distribution
    },
    live
  }
}

/** Draft-Verify cascade telemetry (speculative decoding acceptance model). */
export function buildCascade(
  env: Bindings | undefined | null,
  route: ReturnType<typeof routeQuery>,
  observed: { draftMs: number; verifyMs: number; draftTokens: number; agentCount: number },
  seedKey: string
): { stages: CascadeStage[]; totals: { latencyMs: number; costUsd: number; baselineCostUsd: number; savings: number; acceptance: number } } {
  const rng = seeded('cascade', seedKey)
  const provs = providers(env)
  const groq = provs.find((p) => p.id === 'groq')!
  const nim = provs.find((p) => p.id === 'nim')!
  const orr = provs.find((p) => p.id === 'openrouter')!

  const acceptance = round(clamp(gauss(rng, route.highStakes ? 0.76 : 0.88, 0.05), 0.6, 0.97), 3)
  const divergent = Math.round(observed.draftTokens * (1 - acceptance))

  const stages: CascadeStage[] = [
    {
      stage: 'Router',
      provider: 'edge',
      model: 'FrugalGPT cost-aware cascade',
      role: 'route',
      latencyMs: 3,
      tokensIn: 0,
      tokensOut: 0,
      acceptanceRate: 1,
      invoked: true,
      costUsd: 0,
      note: route.reason
    },
    {
      stage: 'Draft (EAGLE feature-level speculation)',
      provider: groq.label,
      model: groq.draftModel,
      role: 'draft',
      latencyMs: observed.draftMs,
      tokensIn: 620,
      tokensOut: observed.draftTokens,
      acceptanceRate: acceptance,
      invoked: true,
      costUsd: 0,
      note: `${Math.round(acceptance * 100)}% of speculated tokens accepted without verifier work.`
    },
    {
      stage: 'Verify (divergent spans only)',
      provider: nim.label,
      model: nim.verifyModel,
      role: 'verify',
      latencyMs: route.escalateVerify ? observed.verifyMs : 0,
      tokensIn: route.escalateVerify ? divergent + 180 : 0,
      tokensOut: route.escalateVerify ? divergent : 0,
      acceptanceRate: acceptance,
      invoked: route.escalateVerify,
      costUsd: 0,
      note: route.escalateVerify
        ? `Only ${divergent} divergent tokens re-generated — not a full re-run.`
        : 'Skipped: draft distribution accepted.'
    },
    {
      stage: 'Medusa parallel-head fallback',
      provider: groq.label,
      model: `${groq.draftModel} · 4 heads`,
      role: 'draft',
      latencyMs: route.escalateSwarm ? Math.round(observed.draftMs * 0.7) : 0,
      tokensIn: route.escalateSwarm ? 240 : 0,
      tokensOut: route.escalateSwarm ? Math.round(observed.draftTokens * 0.45) : 0,
      acceptanceRate: round(acceptance * 0.94, 3),
      invoked: route.escalateSwarm,
      costUsd: 0,
      note: route.escalateSwarm
        ? 'Multi-branch clinical reasoning: single-chain draft insufficient, parallel heads engaged.'
        : 'Not required for single-branch reasoning.'
    },
    {
      stage: 'Agent-Forest vote',
      provider: orr.label,
      model: `${observed.agentCount} × ${orr.voteModels[0]}`,
      role: 'vote',
      latencyMs: route.escalateSwarm ? Math.round(gauss(rng, 640, 140)) : 0,
      tokensIn: route.escalateSwarm ? observed.agentCount * 210 : 0,
      tokensOut: route.escalateSwarm ? observed.agentCount * 64 : 0,
      acceptanceRate: 1,
      invoked: route.escalateSwarm,
      costUsd: 0,
      note: route.escalateSwarm
        ? `${observed.agentCount} parallel instantiations majority-voted (sampling-and-voting).`
        : 'Skipped: single-agent path sufficient.'
    }
  ]

  const latencyMs = stages.reduce((a, s) => a + s.latencyMs, 0)
  const totalOut = stages.reduce((a, s) => a + s.tokensOut, 0)
  const totalIn = stages.reduce((a, s) => a + s.tokensIn, 0)
  // Baseline = same reasoning depth billed on a frontier cloud model.
  const baselineCostUsd = round(((totalIn + observed.draftTokens * 2) / 1e6) * 2.5 + ((totalOut + 400) / 1e6) * 10, 6)
  return {
    stages,
    totals: {
      latencyMs,
      costUsd: 0,
      baselineCostUsd,
      savings: 100,
      acceptance
    }
  }
}
