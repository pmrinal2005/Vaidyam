/** Shared contracts between the edge API and the dashboard client. */

export type Bindings = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_KEY?: string
  GROQ_API_KEY?: string
  NVIDIA_NIM_API_KEY?: string
  OPENROUTER_API_KEY?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  USDA_API_KEY?: string
  /** Present on Next.js / Drizzle hosts; unused by the pure edge path. */
  DATABASE_URL?: string
}

export type Provenance = {
  source: string
  live: boolean
  fetchedAt: string
  detail?: string
}

export type Envelope<T> = {
  ok: boolean
  data: T
  provenance: Provenance[]
  degraded: boolean
  ms: number
}

export type GraphNode = {
  id: string
  label: string
  domain: 'medication' | 'sleep' | 'environment' | 'mental' | 'nutrition' | 'vital' | 'finance' | 'symptom'
  kind: 'entity' | 'observation' | 'community'
  weight: number
  community: number
  ppr?: number
}

export type GraphEdge = {
  source: string
  target: string
  relation: string
  strength: number
  lagHours: number
  confidence: number
  citations?: number[]
}

export type CausalGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: { id: number; label: string; summary: string; size: number }[]
  stats: { nodes: number; edges: number; density: number; avgDegree: number; version: string }
}

export type SwarmAgent = {
  id: string
  name: string
  domain: string
  layer: number
  provider: 'groq' | 'nim' | 'openrouter' | 'proxy' | 'local'
  model: string
  status: 'idle' | 'drafting' | 'verifying' | 'voting' | 'done'
  latencyMs: number
  tokens: number
  confidence: number
  vote: string
  rationale: string
}

export type CascadeStage = {
  stage: string
  provider: string
  model: string
  role: 'draft' | 'verify' | 'vote' | 'route'
  latencyMs: number
  tokensIn: number
  tokensOut: number
  acceptanceRate: number
  invoked: boolean
  costUsd: number
  note: string
}
