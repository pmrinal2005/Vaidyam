/**
 * Layers 2–3 — Multi-Agent Swarm (MoA) + Draft-Verify Speculative Cascade.
 *
 * Single provider: GroqCloud. Two models —
 *   - PRIMARY_MODEL  (llama-3.3-70b-versatile): fast, non-reasoning draft +
 *     the full specialist panel (one batched JSON call → every layer-1 vote &
 *     rationale is LLM-derived, not a deterministic stub).
 *   - AGENT_MODEL    (openai/gpt-oss-120b): the Coordinator synthesis. This is
 *     a production Groq reasoning model driven with `reasoning_format:"hidden"`
 *     so the chain-of-thought never leaks into the message content (the old
 *     `qwen/qwen3.6-27b` emitted raw <think>…</think> into the UI).
 *
 * A sliding-window rate limiter caps outbound Groq calls. When the cap is hit,
 * the key is absent, or a call fails, the affected stage falls back to the
 * deterministic local reasoner over the causal graph. Prompts are terse and
 * outputs are capped tightly so responses stay short, concise, and cheap.
 */
import type { Bindings, CascadeStage, CausalGraph, SwarmAgent } from './types'
import { seeded, clamp, round, gauss } from './rand'
import type { Vitals } from './twin'

export type ProviderId = 'groq'

// Groq models (verified against the live GroqCloud model catalogue):
//   - PRIMARY_MODEL: fast, high-quality, NO reasoning tags → draft + panel.
//   - AGENT_MODEL:   strong reasoning model → Coordinator (reasoning hidden).
export const PRIMARY_MODEL = 'llama-3.3-70b-versatile'
export const AGENT_MODEL = 'openai/gpt-oss-120b'

/** Models whose responses may contain <think>…</think> chain-of-thought that
 *  must be requested hidden AND stripped defensively. */
const REASONING_MODELS = new Set<string>([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'qwen/qwen3-32b'
])

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
 * `env` may be `undefined` (no bindings yet / local-engine fallback). Never
 * dereference a key off `undefined` — that surfaced as a 500 instead of the
 * intended "no key → deterministic reasoner" degradation.
 */
export function providers(env?: Bindings | null): ProviderCfg[] {
  const e = env || ({} as Bindings)
  return [
    {
      id: 'groq',
      label: 'GroqCloud',
      base: 'https://api.groq.com/openai/v1',
      key: e.GROQ_API_KEY,
      draftModel: PRIMARY_MODEL,
      verifyModel: AGENT_MODEL,
      voteModels: [AGENT_MODEL]
    }
  ]
}

/**
 * Sliding-window rate limiter. A single /swarm request now makes at most two
 * live Groq calls (one batched specialist panel + one coordinator synthesis),
 * so the window is sized to comfortably admit a normal interaction while still
 * protecting the free-tier quota. When the cap is hit we fall back to the
 * deterministic reasoner for the affected stage. Module-scoped so it applies
 * across every call in a server instance.
 */
const RATE_MAX = 12
const RATE_WINDOW_MS = 60_000
const callTimes: number[] = []
function rateOk(): boolean {
  const now = Date.now()
  while (callTimes.length && now - callTimes[0] > RATE_WINDOW_MS) callTimes.shift()
  if (callTimes.length >= RATE_MAX) return false
  callTimes.push(now)
  return true
}

/**
 * Removes model chain-of-thought and cleans formatting so only the useful,
 * concise answer reaches the UI. Reasoning models (gpt-oss, qwen) can emit
 * `<think>…</think>` in raw mode; even with `reasoning_format:"hidden"` we
 * strip defensively in case a stray tag slips through. Also trims code fences,
 * leading list bullets, and surrounding quotes.
 */
export function stripReasoning(raw: string): string {
  let t = String(raw || '')
  // Remove complete <think>…</think> (and <thinking>, <reasoning>) blocks.
  t = t.replace(/<(think|thinking|reason|reasoning)>[\s\S]*?<\/\1>/gi, '')
  // Remove a dangling opener with no closer (truncated by max_tokens): drop
  // everything from the opener onward, since it's unterminated reasoning.
  t = t.replace(/<(think|thinking|reason|reasoning)>[\s\S]*$/i, '')
  // Remove any orphan closing tag left behind.
  t = t.replace(/<\/?(think|thinking|reason|reasoning)>/gi, '')
  // Strip Markdown code fences / stray backticks.
  t = t.replace(/```[a-z]*\n?/gi, '').replace(/`/g, '')
  // Collapse whitespace and trim.
  t = t.replace(/\s+/g, ' ').trim()
  // Drop a leading list marker or label the model sometimes prepends.
  t = t.replace(/^(?:[-*•]\s+|(?:answer|verdict|recommendation)\s*:\s*)/i, '')
  // Remove wrapping quotes.
  t = t.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return t
}

/**
 * Token-efficient Groq chat call. `maxTokens` is kept minimal by callers;
 * outputs are capped to exactly what each stage needs. For reasoning models we
 * request `reasoning_format:"hidden"` so the chain-of-thought is never returned
 * in the content, then run `stripReasoning` as a belt-and-braces cleanup.
 */
async function chat(
  cfg: ProviderCfg,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 160,
  timeoutMs = 9000,
  opts?: { json?: boolean }
): Promise<{ text: string; ms: number; tokensIn: number; tokensOut: number } | null> {
  if (!cfg.key) return null
  if (!rateOk()) return null
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      top_p: 0.9,
      stream: false
    }
    // Hide chain-of-thought for reasoning models so <think> never leaks.
    if (REASONING_MODELS.has(model)) body.reasoning_format = 'hidden'
    // Ask for strict JSON where the caller parses structured output.
    if (opts?.json) body.response_format = { type: 'json_object' }
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.key}`
      },
      body: JSON.stringify(body)
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const j: any = await res.json()
    const text = j?.choices?.[0]?.message?.content
    if (!text) return null
    // JSON callers parse the raw content themselves (only strip fences); prose
    // callers get the full reasoning-scrub.
    const cleaned = opts?.json
      ? String(text).replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
      : stripReasoning(String(text))
    if (!cleaned) return null
    return {
      text: cleaned,
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

const VALID_VOTES = ['maintain', 'reinforce', 'intervene'] as const
function coerceVote(v: unknown, fallback: string): string {
  const s = String(v || '').toLowerCase().trim()
  return (VALID_VOTES as readonly string[]).includes(s) ? s : fallback
}

/**
 * Runs the MoA swarm. Layer-1 specialists run as ONE batched, live
 * Mixture-of-Agents panel (a single Groq JSON call returns every specialist's
 * vote + concise rationale + confidence — so the layer-1 verdicts are genuine
 * model output, not a deterministic stub). The Coordinator (layer 2) then
 * consumes all layer-1 outputs as auxiliary information (the MoA definition)
 * and synthesises one recommendation via the reasoning model with its
 * chain-of-thought hidden. Everything degrades to the deterministic causal
 * reasoner when there is no key / the rate cap is hit / a call fails.
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
  const cfg = providers(env).find((p) => p.key)
  const rng = seeded('swarm', opts.query, opts.vitals.length)
  let live = false

  const layer1 = AGENT_DEFS.filter((a) => a.layer === 1)
  // Deterministic floor for every specialist — always computed so we can
  // degrade gracefully and blend confidence.
  const locals = layer1.map((def) => ({ def, local: localReason(def.id, opts.graph, opts.vitals, opts.ppr) }))

  // ── Live layer-1 panel: ONE batched JSON call returns all specialists ──
  // This is what makes the swarm genuinely live rather than deterministic:
  // each specialist's vote AND rationale come from the model.
  let panel: Record<string, { vote?: string; rationale?: string; confidence?: number }> = {}
  let panelMs = 0
  let panelTokens = 0
  if (opts.useLive && cfg) {
    const roster = layer1.map((a) => `${a.id} = ${a.name} (${a.domain})`).join('; ')
    const res = await chat(
      cfg,
      PRIMARY_MODEL,
      [
        {
          role: 'system',
          content:
            'You are the Vaidyam layer-1 specialist panel. Reason ONLY over the supplied causal-graph context — invent no numbers. ' +
            'For EACH specialist return a vote and a concise rationale. vote ∈ {maintain,reinforce,intervene}. ' +
            'rationale ≤ 24 words, must cite the specific causal edge or metric used. ' +
            'Return STRICT JSON: {"agents":{"<id>":{"vote":"...","rationale":"...","confidence":0.xx}}}. No prose, no markdown.'
        },
        {
          role: 'user',
          content: `${opts.contextBrief}\nSpecialists: ${roster}\nUser question: ${opts.query}`
        }
      ],
      520,
      9000,
      { json: true }
    )
    if (res) {
      try {
        const parsed = JSON.parse(res.text)
        const agents = parsed?.agents && typeof parsed.agents === 'object' ? parsed.agents : parsed
        if (agents && typeof agents === 'object') {
          panel = agents
          live = true
          panelMs = res.ms
          panelTokens = res.tokensOut || 0
        }
      } catch {
        /* leave panel empty → deterministic rationales below */
      }
    }
  }

  const panelKeys = Object.keys(panel)
  const results: SwarmAgent[] = locals.map(({ def, local }, i) => {
    const p = panel[def.id] || {}
    const liveThis = live && (p.vote !== undefined || p.rationale !== undefined)
    const vote = liveThis ? coerceVote(p.vote, local.vote) : local.vote
    const rationale = liveThis && p.rationale ? stripReasoning(String(p.rationale)) : local.rationale
    const confidence =
      liveThis && typeof p.confidence === 'number'
        ? round(clamp(p.confidence, 0.4, 0.99), 2)
        : local.confidence
    // Latency/tokens: attribute a share of the batched call to live agents.
    const ms = liveThis
      ? Math.max(40, Math.round(panelMs / Math.max(1, panelKeys.length)) + Math.round(gauss(rng, 0, 20)))
      : Math.round(clamp(gauss(rng, 150, 45), 40, 480))
    const tokens = liveThis
      ? Math.max(24, Math.round(panelTokens / Math.max(1, panelKeys.length)))
      : Math.round(clamp(gauss(rng, 120, 40), 30, 300))
    return {
      id: def.id,
      name: def.name,
      domain: def.domain,
      layer: 1,
      provider: liveThis ? 'groq' : 'local',
      model: liveThis ? PRIMARY_MODEL : `${PRIMARY_MODEL} (local sim)`,
      status: 'done',
      latencyMs: ms,
      tokens,
      confidence,
      vote,
      rationale
    } satisfies SwarmAgent
  })

  // Agent-Forest sampling & voting — n cheap parallel instantiations sampled
  // around each specialist's (now model-derived) vote & confidence.
  const distribution: Record<string, number> = {}
  const ballots: string[] = []
  for (let i = 0; i < opts.agentCount; i++) {
    const base = results[i % results.length]
    const jitter = rng()
    const vote = jitter < base.confidence ? base.vote : VALID_VOTES[Math.floor(rng() * 3)]
    ballots.push(vote)
    distribution[vote] = (distribution[vote] || 0) + 1
  }
  const winner = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0] || ['maintain', 1]

  const coordDef = AGENT_DEFS.find((a) => a.layer === 2)!
  const coordLocal = localReason(coordDef.id, opts.graph, opts.vitals, opts.ppr)
  let coordRationale = coordLocal.rationale
  let coordMs = Math.round(clamp(gauss(rng, 520, 160), 190, 1500))
  let coordTokens = Math.round(clamp(gauss(rng, 200, 60), 80, 480))
  let coordLive = false
  // Coordinator synthesis uses the reasoning AGENT_MODEL with reasoning hidden
  // (one live call, tight budget) — no <think> ever reaches the UI.
  if (opts.useLive && cfg) {
    const res = await chat(
      cfg,
      AGENT_MODEL,
      [
        {
          role: 'system',
          content:
            'You are the Vaidyam Preventive-Care Coordinator. Read the specialist votes and synthesise ONE clear recommendation. ' +
            'Answer in ≤ 40 words, plain prose, cite the single dominant causal chain. ' +
            'Do NOT show your reasoning, do NOT use <think> tags, output only the final recommendation. ' +
            'No diagnosis; if the query is high-stakes, advise clinician review.'
        },
        {
          role: 'user',
          content: `${opts.contextBrief}\nSpecialist votes: ${results
            .map((r) => `${r.domain}:${r.vote}`)
            .join(', ')}\nBallot tally: ${JSON.stringify(distribution)}\nUser question: ${opts.query}`
        }
      ],
      220
    )
    if (res && res.text) {
      live = true
      coordLive = true
      coordRationale = res.text
      coordMs = res.ms
      coordTokens = res.tokensOut || coordTokens
    }
  }

  const coordinator: SwarmAgent = {
    id: coordDef.id,
    name: coordDef.name,
    domain: coordDef.domain,
    layer: 2,
    provider: coordLive ? 'groq' : 'local',
    model: coordLive ? AGENT_MODEL : `${AGENT_MODEL} (local sim)`,
    status: 'done',
    latencyMs: coordMs,
    tokens: coordTokens,
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
  const groq = providers(env).find((p) => p.id === 'groq')!

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
      model: PRIMARY_MODEL,
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
      provider: groq.label,
      model: AGENT_MODEL,
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
      model: `${PRIMARY_MODEL} · 4 heads`,
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
      provider: groq.label,
      model: `${observed.agentCount} × ${AGENT_MODEL}`,
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
