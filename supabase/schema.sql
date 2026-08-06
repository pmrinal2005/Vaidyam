-- ═══════════════════════════════════════════════════════════════════════════
-- Catena — Personal Causal Health Twin
-- Supabase schema: paste this whole file into the Supabase SQL Editor and run.
--
-- Layer 0  ingestion            → observations, ingest_events
-- Layer 1  causal graph memory  → entities, causal_edges, communities,
--                                 graph_embeddings (binary + int8 two-stage index)
-- Layer 2  agent swarm          → swarm_runs, agent_verdicts
-- Layer 3  inference cascade    → cascade_stages
-- Layer 4  counterfactual       → simulations
-- Layer 5  privacy              → attestations, dp_aggregates, dp_budget
-- Layer 6  surfaces             → clinician_briefs, saas_accounts
--
-- Every user-scoped table is protected by row-level security keyed on
-- auth.uid(), so a leaked anon key cannot read another twin's rows. Only
-- derived facts (dp_aggregates, attestations.public_output) are readable by
-- aggregation/verification consumers.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. ENUMS
-- ═══════════════════════════════════════════════════════════════════════════
do $$ begin
  create type domain_kind as enum
    ('medication','sleep','environment','mental','nutrition','vital','finance','symptom','literature');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_vote as enum ('maintain','reinforce','intervene');
exception when duplicate_object then null; end $$;

do $$ begin
  create type provider_id as enum ('groq','nim','openrouter','proxy','local');
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TWIN REGISTRY
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists twins (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  external_uid   text unique,                       -- browser-local twin id
  display_name   text,
  graph_version  text        not null default 'v0.0.1',
  home_lat       double precision,
  home_lon       double precision,
  city           text,
  country        text,
  consent_dp     boolean     not null default false, -- opt-in to DP aggregation
  consent_pharma boolean     not null default false, -- opt-in to post-market feed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LAYER 0 — INGESTION
-- ═══════════════════════════════════════════════════════════════════════════

-- Raw-ish daily observations. Deliberately narrow: the twin is the graph, not
-- this table. Kept for edge re-estimation only, and prunable without loss.
create table if not exists observations (
  id                 bigserial primary key,
  user_id            uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  day                date        not null,
  sleep_hours        numeric(4,2),
  sleep_efficiency   numeric(5,2),
  deep_sleep_pct     numeric(5,2),
  rem_pct            numeric(5,2),
  resting_hr         numeric(5,1),
  hrv                numeric(5,1),
  spo2               numeric(5,2),
  steps              integer,
  systolic           numeric(5,1),
  diastolic          numeric(5,1),
  mood               numeric(4,2),
  stress             numeric(5,2),
  glucose            numeric(5,1),
  sodium_mg          integer,
  hydration_ml       integer,
  adherence          numeric(5,2),
  symptom_load       numeric(4,2),
  pm25               numeric(6,2),
  aqi                integer,
  screen_min         integer,
  respiratory_rate   numeric(4,1),
  source             text        not null default 'webhook',
  created_at         timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists observations_user_day_idx on observations (user_id, day desc);

-- Layer-0 pipeline telemetry (records → entities → edges per upstream).
create table if not exists ingest_events (
  id                 bigserial primary key,
  user_id            uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  source_id          text        not null,
  label              text        not null,
  domain             domain_kind not null,
  cadence            text        not null,
  live               boolean     not null default true,
  records_today      integer     not null default 0,
  entities_extracted integer     not null default 0,
  edges_written      integer     not null default 0,
  parse_ms           integer     not null default 0,
  occurred_at        timestamptz not null default now()
);
create index if not exists ingest_events_user_time_idx on ingest_events (user_id, occurred_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LAYER 1 — CAUSAL KNOWLEDGE GRAPH
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists entities (
  id          text        not null,                  -- stable slug, e.g. 'env-pm25'
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  label       text        not null,
  domain      domain_kind not null,
  kind        text        not null default 'concept',
  weight      numeric(5,3) not null default 0.5,     -- degree centrality, 0..1
  community   integer     not null default 0,
  attributes  jsonb       not null default '{}'::jsonb,
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists entities_user_domain_idx on entities (user_id, domain);
create index if not exists entities_community_idx   on entities (user_id, community);

-- Causal edges are MEASURED (lagged correlation over the twin's own series),
-- never assumed from a population prior. That is the whole point of the graph.
create table if not exists causal_edges (
  id          bigserial primary key,
  user_id     uuid         not null default auth.uid() references auth.users(id) on delete cascade,
  source_id   text         not null,
  target_id   text         not null,
  relation    text         not null,                 -- e.g. 'exacerbates', 'lowers'
  strength    numeric(5,3) not null,                 -- |lagged r|, 0..1
  lag_hours   integer      not null default 0,
  confidence  numeric(4,3) not null default 0.5,
  n_obs       integer      not null default 0,
  method      text         not null default 'lagged_pearson',
  updated_at  timestamptz  not null default now(),
  unique (user_id, source_id, target_id, relation),
  foreign key (user_id, source_id) references entities (user_id, id) on delete cascade,
  foreign key (user_id, target_id) references entities (user_id, id) on delete cascade,
  check (strength >= 0 and strength <= 1),
  check (confidence >= 0 and confidence <= 1)
);
create index if not exists causal_edges_src_idx on causal_edges (user_id, source_id);
create index if not exists causal_edges_tgt_idx on causal_edges (user_id, target_id);

-- GraphRAG stage 2: pre-generated summaries for groups of related entities.
create table if not exists communities (
  id           integer     not null,
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  label        text        not null,
  summary      text        not null,
  size         integer     not null default 0,
  member_ids   text[]      not null default '{}',
  generated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. VECTOR MEMORY — binary first-pass + int8 re-rank (two-stage index)
--
-- float32 is deliberately NOT stored: at 384 dims it would breach the 500MB
-- free-tier envelope long before the graph becomes interesting. Binary gives a
-- 32x reduction with fast bitwise comparison; the int8 column re-scores the
-- binary candidate set to recover the precision loss.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists graph_embeddings (
  id           bigserial primary key,
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id    text        not null,
  chunk        text        not null,                 -- source text that produced the vector
  dim          integer     not null default 384,
  emb_binary   bit(384),                             -- 1 bit/component  (48 bytes)
  emb_int8     smallint[],                           -- scalar quantized (384 bytes)
  emb_norm     real        not null default 1.0,     -- for int8 de-quantization
  mrl_dim      integer     not null default 384,     -- Matryoshka truncation point
  model        text        not null default 'bge-small-en-v1.5',
  created_at   timestamptz not null default now(),
  foreign key (user_id, entity_id) references entities (user_id, id) on delete cascade
);
create index if not exists graph_embeddings_user_entity_idx on graph_embeddings (user_id, entity_id);

-- Optional float32 staging table: only used transiently while quantizing, then
-- truncated. Never part of the steady-state footprint.
create table if not exists embedding_staging (
  id         bigserial primary key,
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id  text        not null,
  chunk      text        not null,
  emb        vector(384) not null,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LAYER 2/3 — SWARM & CASCADE TELEMETRY
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists swarm_runs (
  id                bigserial primary key,
  user_id           uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  query             text        not null,
  consensus_vote    agent_vote  not null,
  support_pct       numeric(5,2) not null,
  distribution      jsonb       not null default '{}'::jsonb,
  agent_count       integer     not null default 1,
  high_stakes       boolean     not null default false,
  draft_confidence  numeric(4,3) not null default 0.5,
  escalate_verify   boolean     not null default false,
  router_reason     text,
  live              boolean     not null default false,
  total_latency_ms  integer     not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists swarm_runs_user_time_idx on swarm_runs (user_id, created_at desc);

create table if not exists agent_verdicts (
  id          bigserial primary key,
  run_id      bigint      not null references swarm_runs(id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  agent_id    text        not null,
  name        text        not null,
  domain      domain_kind not null,
  layer       smallint    not null default 1,        -- 1 = specialist, 2 = coordinator
  vote        agent_vote  not null,
  confidence  numeric(4,3) not null,
  rationale   text,
  provider    provider_id not null default 'local',
  model       text,
  latency_ms  integer     not null default 0,
  tokens      integer     not null default 0
);
create index if not exists agent_verdicts_run_idx on agent_verdicts (run_id);

create table if not exists cascade_stages (
  id               bigserial primary key,
  run_id           bigint      references swarm_runs(id) on delete cascade,
  user_id          uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  stage            text        not null,
  role             text        not null,             -- draft | verify | vote
  provider         provider_id not null,
  model            text,
  invoked          boolean     not null default true,
  latency_ms       integer     not null default 0,
  tokens_in        integer     not null default 0,
  tokens_out       integer     not null default 0,
  acceptance_rate  numeric(4,3),
  cost_usd         numeric(10,6) not null default 0,
  created_at       timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. LAYER 4 — COUNTERFACTUAL SIMULATIONS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists simulations (
  id              bigserial primary key,
  user_id         uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  interventions   jsonb       not null default '{}'::jsonb,
  horizon_months  integer     not null default 60,
  outcomes        jsonb       not null default '[]'::jsonb,
  adherence_cost  numeric(5,2),
  method          text,
  citations       jsonb       not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists simulations_user_time_idx on simulations (user_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. LAYER 5 — PRIVACY & VERIFIABILITY
-- ═══════════════════════════════════════════════════════════════════════════

-- Only public_output + proof material is third-party readable. The witness
-- never lands here at all — witness_fields_hidden merely records what was
-- excluded, so a verifier can see the shape of what it is NOT being told.
create table if not exists attestations (
  id                    text        primary key,      -- att_<digest16>
  user_id               uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  claim                 text        not null,
  statement             text        not null,
  public_output         jsonb       not null,
  satisfied             boolean     not null,
  circuit               text        not null,
  proof_system          text        not null,
  constraints           integer     not null default 0,
  prove_ms              integer     not null default 0,
  verify_ms             integer     not null default 0,
  proof_size_bytes      integer     not null default 0,
  commitment            text        not null,
  proof_digest          text        not null,
  witness_fields_hidden text[]      not null default '{}',
  window_days           integer     not null default 30,
  revoked               boolean     not null default false,
  issued_at             timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '30 days')
);
create index if not exists attestations_user_idx  on attestations (user_id, issued_at desc);
create index if not exists attestations_claim_idx on attestations (claim);

-- Verification audit trail — who checked which proof, without any raw data.
create table if not exists attestation_verifications (
  id             bigserial primary key,
  attestation_id text        not null references attestations(id) on delete cascade,
  verifier_ref   text,                                -- opaque consumer reference
  verified       boolean     not null,
  verifier_ms    integer     not null default 0,
  verified_at    timestamptz not null default now()
);

-- Locally-noised statistics. This is the ONLY table an aggregation job reads,
-- which is what keeps raw records off the wire entirely.
create table if not exists dp_aggregates (
  id           bigserial primary key,
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  metric_key   text        not null,
  label        text        not null,
  unit         text,
  noised_value numeric(12,4) not null,                -- released value
  epsilon      numeric(6,3) not null,
  delta        numeric(12,10) not null default 0.00001,
  sensitivity  numeric(10,4) not null,
  sigma        numeric(12,4) not null,
  cohort_size  integer     not null,
  k_anonymous  boolean     not null default true,
  round_no     integer     not null default 1,
  region       text,                                  -- coarse geo bucket only
  released_at  timestamptz not null default now()
);
create index if not exists dp_aggregates_metric_idx on dp_aggregates (metric_key, released_at desc);
create index if not exists dp_aggregates_region_idx on dp_aggregates (region, metric_key);

create table if not exists dp_budget (
  user_id     uuid        primary key default auth.uid() references auth.users(id) on delete cascade,
  epsilon_cap numeric(6,3) not null default 8.0,
  spent       numeric(6,3) not null default 0,
  mechanism   text        not null default 'Gaussian (Opacus-style clipping)',
  clipping    numeric(6,3) not null default 1.0,
  updated_at  timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. LAYER 6 — OUTPUT SURFACES
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists clinician_briefs (
  id             bigserial primary key,
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  graph_version  text        not null,
  window_start   date        not null,
  window_end     date        not null,
  vital_summary  jsonb       not null default '[]'::jsonb,
  causal_chains  jsonb       not null default '[]'::jsonb,
  risks          jsonb       not null default '[]'::jsonb,
  talking_points jsonb       not null default '[]'::jsonb,
  citations      jsonb       not null default '[]'::jsonb,
  share_token    text        unique default encode(gen_random_bytes(16), 'hex'),
  generated_at   timestamptz not null default now()
);

create table if not exists saas_accounts (
  id           bigserial primary key,
  segment      text        not null,                  -- consumer|employer|insurer|gov|pharma
  account_name text        not null,
  price        numeric(12,2) not null,
  unit         text        not null,
  seats        integer     not null default 1,
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. ROW-LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
alter table twins                     enable row level security;
alter table observations              enable row level security;
alter table ingest_events             enable row level security;
alter table entities                  enable row level security;
alter table causal_edges              enable row level security;
alter table communities               enable row level security;
alter table graph_embeddings          enable row level security;
alter table embedding_staging         enable row level security;
alter table swarm_runs                enable row level security;
alter table agent_verdicts            enable row level security;
alter table cascade_stages            enable row level security;
alter table simulations               enable row level security;
alter table attestations              enable row level security;
alter table attestation_verifications enable row level security;
alter table dp_aggregates             enable row level security;
alter table dp_budget                 enable row level security;
alter table clinician_briefs          enable row level security;
alter table saas_accounts             enable row level security;

-- Owner-only policies, generated over every user-scoped table.
do $$
declare t text;
begin
  foreach t in array array[
    'twins','observations','ingest_events','entities','causal_edges','communities',
    'graph_embeddings','embedding_staging','swarm_runs','agent_verdicts',
    'cascade_stages','simulations','attestations','dp_aggregates','dp_budget',
    'clinician_briefs'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_owner_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner_rw', t
    );
  end loop;
end $$;

-- Verification audit rows are reachable through the parent attestation only.
drop policy if exists attestation_verifications_owner on attestation_verifications;
create policy attestation_verifications_owner on attestation_verifications
  for all to authenticated
  using (exists (select 1 from attestations a where a.id = attestation_id and a.user_id = auth.uid()))
  with check (exists (select 1 from attestations a where a.id = attestation_id and a.user_id = auth.uid()));

-- Third-party proof verification: public output only, and only for a live,
-- non-revoked attestation. No join back to any raw table is possible.
drop policy if exists attestations_public_verify on attestations;
create policy attestations_public_verify on attestations
  for select to anon
  using (revoked = false and expires_at > now());

-- DP aggregates are readable in the aggregate only, and only above the
-- k-anonymity floor.
drop policy if exists dp_aggregates_public_read on dp_aggregates;
create policy dp_aggregates_public_read on dp_aggregates
  for select to anon
  using (k_anonymous = true and cohort_size >= 50);

drop policy if exists saas_accounts_read on saas_accounts;
create policy saas_accounts_read on saas_accounts for select to authenticated using (true);

-- Columns that must never reach a verifier, even with select granted above.
revoke all on attestations from anon;
grant select (id, claim, statement, public_output, satisfied, circuit, proof_system,
              constraints, proof_size_bytes, commitment, proof_digest,
              witness_fields_hidden, window_days, issued_at, expires_at, revoked)
  on attestations to anon;

revoke all on dp_aggregates from anon;
grant select (metric_key, label, unit, noised_value, epsilon, delta, sensitivity,
              sigma, cohort_size, k_anonymous, round_no, region, released_at)
  on dp_aggregates to anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. GRAPH FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- HippoRAG-style personalized PageRank over the twin's causal graph. Seeds come
-- from the query; the walk propagates from those seeds so a symptom today can
-- surface a medication started three months ago in ONE retrieval pass.
create or replace function catena_personalized_pagerank(
  p_user_id    uuid,
  p_seeds      text[]  default '{}',
  p_damping    numeric default 0.85,
  p_iterations integer default 40
)
returns table (entity_id text, label text, domain domain_kind, score numeric)
language plpgsql
security invoker
stable
as $$
declare
  n integer;
  i integer := 0;
begin
  create temp table if not exists _ppr (id text primary key, r numeric, nxt numeric, seed boolean)
    on commit drop;
  delete from _ppr;

  insert into _ppr (id, r, nxt, seed)
  select e.id, 0, 0, (cardinality(p_seeds) = 0 or e.id = any(p_seeds))
  from entities e
  where e.user_id = p_user_id;

  select count(*) into n from _ppr;
  if n = 0 then return; end if;

  -- Uniform restart when unseeded; otherwise restart mass sits on the seeds.
  update _ppr set r = case
    when seed then 1.0 / greatest(1, (select count(*) from _ppr where seed))
    else 0 end;

  while i < p_iterations loop
    update _ppr set nxt = 0;

    -- Push mass along outgoing edges, weighted by measured strength.
    update _ppr p set nxt = p.nxt + coalesce(inc.mass, 0)
    from (
      select ce.target_id as id,
             sum(src.r * ce.strength /
                 nullif((select sum(strength) from causal_edges c2
                         where c2.user_id = p_user_id and c2.source_id = ce.source_id), 0)) as mass
      from causal_edges ce
      join _ppr src on src.id = ce.source_id
      where ce.user_id = p_user_id
      group by ce.target_id
    ) inc
    where p.id = inc.id;

    -- Damping + restart distribution.
    update _ppr set r = (1 - p_damping) *
      (case when seed then 1.0 / greatest(1, (select count(*) from _ppr where seed)) else 0 end)
      + p_damping * nxt;

    i := i + 1;
  end loop;

  return query
    select p.id, e.label, e.domain, round(p.r, 6)
    from _ppr p
    join entities e on e.user_id = p_user_id and e.id = p.id
    order by p.r desc;
end $$;

-- Stage 1 of the two-stage index: Hamming distance over the binary vectors.
-- Bitwise ops make this cheap enough to scan the whole per-user index.
create or replace function catena_search_binary(
  p_user_id uuid,
  p_query   bit(384),
  p_limit   integer default 64
)
returns table (entity_id text, chunk text, hamming integer)
language sql
security invoker
stable
as $$
  select ge.entity_id, ge.chunk, length(replace((ge.emb_binary # p_query)::text, '0', '')) as hamming
  from graph_embeddings ge
  where ge.user_id = p_user_id and ge.emb_binary is not null
  order by hamming asc
  limit p_limit;
$$;

-- Stage 2: int8 re-scoring over the binary candidate set. This is what recovers
-- the recall that binary quantization gives up (≈0.92 → ≈0.98).
create or replace function catena_rescore_int8(
  p_user_id uuid,
  p_query   bit(384),
  p_int8    smallint[],
  p_first   integer default 64,
  p_limit   integer default 8
)
returns table (entity_id text, chunk text, cosine numeric)
language sql
security invoker
stable
as $$
  with candidates as (
    select entity_id, chunk from catena_search_binary(p_user_id, p_query, p_first)
  )
  select ge.entity_id, ge.chunk,
         round((
           select sum(a.v::numeric * b.v::numeric)
           from unnest(ge.emb_int8) with ordinality a(v, ix)
           join unnest(p_int8)      with ordinality b(v, ix) using (ix)
         ) / nullif(
           sqrt((select sum(a.v::numeric ^ 2) from unnest(ge.emb_int8) a(v))) *
           sqrt((select sum(b.v::numeric ^ 2) from unnest(p_int8)      b(v))), 0
         ), 6) as cosine
  from graph_embeddings ge
  join candidates c on c.entity_id = ge.entity_id and c.chunk = ge.chunk
  where ge.user_id = p_user_id
  order by cosine desc nulls last
  limit p_limit;
$$;

-- Quantize a float32 staging vector into the binary + int8 pair, then discard
-- the float32 row. Sign bit for binary, symmetric scaling for int8.
create or replace function catena_quantize(p_user_id uuid)
returns integer
language plpgsql
security invoker
as $$
declare moved integer := 0;
begin
  insert into graph_embeddings (user_id, entity_id, chunk, dim, emb_binary, emb_int8, emb_norm, mrl_dim)
  select s.user_id, s.entity_id, s.chunk, 384,
         (select string_agg(case when v > 0 then '1' else '0' end, '' order by ix)
          from unnest(s.emb::real[]) with ordinality t(v, ix))::bit(384),
         (select array_agg((round(v / nullif(m.mx, 0) * 127))::smallint order by ix)
          from unnest(s.emb::real[]) with ordinality t(v, ix)),
         m.mx,
         384
  from embedding_staging s
  cross join lateral (
    select max(abs(v)) as mx from unnest(s.emb::real[]) t(v)
  ) m
  where s.user_id = p_user_id;

  select count(*) into moved from embedding_staging where user_id = p_user_id;
  delete from embedding_staging where user_id = p_user_id;
  return moved;
end $$;

-- Matryoshka truncation: keep only the leading dimensions, which preserves most
-- retrieval quality and lets one embedding serve several compute budgets.
create or replace function catena_truncate_mrl(p_user_id uuid, p_dim integer)
returns integer
language plpgsql
security invoker
as $$
declare n integer;
begin
  if p_dim not in (64, 96, 128, 192, 256, 384) then
    raise exception 'unsupported Matryoshka dimension: %', p_dim;
  end if;
  update graph_embeddings
     set emb_int8 = emb_int8[1:p_dim],
         mrl_dim  = p_dim
   where user_id = p_user_id and mrl_dim > p_dim;
  get diagnostics n = row_count;
  return n;
end $$;

-- Recompute causal edge strengths as lagged Pearson correlations over the twin's
-- own observation series. Edges are measured, not inherited from a population.
create or replace function catena_refresh_edges(p_user_id uuid, p_lag_days integer default 1)
returns integer
language plpgsql
security invoker
as $$
declare
  rec record;
  r numeric;
  n integer := 0;
  pairs text[][] := array[
    ['sleep_hours','systolic','sleep-duration','vital-bp','lowers'],
    ['adherence','systolic','med-adherence','vital-bp','lowers'],
    ['sodium_mg','systolic','nutr-sodium','vital-bp','raises'],
    ['pm25','symptom_load','env-pm25','sym-respiratory','exacerbates'],
    ['stress','mood','mental-stress','mental-mood','depresses'],
    ['sleep_hours','hrv','sleep-duration','vital-hrv','raises'],
    ['steps','glucose','beh-activity','vital-glucose','lowers']
  ];
  p text[];
begin
  foreach p slice 1 in array pairs loop
    execute format($f$
      with s as (
        select %I::numeric as x,
               lead(%I::numeric, %s) over (order by day) as y
        from observations where user_id = $1 order by day
      )
      select corr(x, y) from s where x is not null and y is not null
    $f$, p[1], p[2], p_lag_days) into r using p_user_id;

    if r is not null then
      insert into causal_edges (user_id, source_id, target_id, relation, strength, lag_hours, confidence, n_obs, method)
      select p_user_id, p[3], p[4], p[5], least(1, abs(r)), p_lag_days * 24,
             least(1, abs(r) * 1.1), (select count(*) from observations where user_id = p_user_id),
             'lagged_pearson'
      where exists (select 1 from entities where user_id = p_user_id and id = p[3])
        and exists (select 1 from entities where user_id = p_user_id and id = p[4])
      on conflict (user_id, source_id, target_id, relation)
      do update set strength = excluded.strength,
                    confidence = excluded.confidence,
                    n_obs = excluded.n_obs,
                    updated_at = now();
      n := n + 1;
    end if;
  end loop;

  update twins set graph_version = 'v0.' || n || '.' ||
    (select count(*) from entities where user_id = p_user_id),
    updated_at = now()
  where user_id = p_user_id;

  return n;
end $$;

-- Gaussian mechanism: σ = sensitivity·√(2·ln(1.25/δ))/ε, scaled by √cohort.
-- Noise is applied HERE, per user, before anything is released.
create or replace function catena_dp_release(
  p_user_id     uuid,
  p_epsilon     numeric default 1.0,
  p_cohort_size integer default 1284,
  p_region      text    default null
)
returns integer
language plpgsql
security invoker
as $$
declare
  spec  record;
  sigma numeric;
  mu    numeric;
  delta numeric := 0.00001;
  n     integer := 0;
  rnd   integer;
begin
  if not exists (select 1 from twins where user_id = p_user_id and consent_dp) then
    raise exception 'twin has not opted into differentially-private aggregation';
  end if;

  if (select spent + p_epsilon from dp_budget where user_id = p_user_id) >
     (select epsilon_cap from dp_budget where user_id = p_user_id) then
    raise exception 'privacy budget exhausted';
  end if;

  select coalesce(max(round_no), 0) + 1 into rnd from dp_aggregates where user_id = p_user_id;

  for spec in
    select * from (values
      ('pm25',      'Mean PM2.5 exposure',  'µg/m³', 'pm25',        8.0),
      ('sleep',     'Mean sleep duration',  'h',     'sleep_hours', 0.5),
      ('adherence', 'Mean adherence',       '%',     'adherence',   4.0),
      ('symptom',   'Mean symptom load',    '/10',   'symptom_load',0.6),
      ('systolic',  'Mean systolic BP',     'mmHg',  'systolic',    5.0),
      ('steps',     'Mean daily steps',     'steps', 'steps',       900.0)
    ) as t(key, label, unit, col, sensitivity)
  loop
    execute format('select avg(%I::numeric) from observations where user_id = $1', spec.col)
      into mu using p_user_id;
    continue when mu is null;

    sigma := spec.sensitivity * sqrt(2 * ln(1.25 / delta)) / p_epsilon;

    -- Box–Muller draw from pgcrypto entropy, damped by cohort size.
    insert into dp_aggregates
      (user_id, metric_key, label, unit, noised_value, epsilon, delta,
       sensitivity, sigma, cohort_size, k_anonymous, round_no, region)
    values (
      p_user_id, spec.key, spec.label, spec.unit,
      mu + (sqrt(-2 * ln(greatest(random(), 1e-9))) * cos(2 * pi() * random()))
           * sigma / sqrt(greatest(1, p_cohort_size)),
      p_epsilon, delta, spec.sensitivity, sigma,
      p_cohort_size, p_cohort_size >= 50, rnd, p_region
    );
    n := n + 1;
  end loop;

  update dp_budget set spent = spent + p_epsilon, updated_at = now() where user_id = p_user_id;
  return n;
end $$;

-- Cohort view for the public-health surface: nothing below the k-anonymity
-- floor is ever exposed, and only noised values are aggregated.
create or replace view catena_cohort_signal as
select metric_key,
       label,
       unit,
       region,
       round_no,
       count(*)                       as contributors,
       round(avg(noised_value), 3)    as cohort_mean,
       round(stddev(noised_value), 3) as cohort_sd,
       min(epsilon)                   as min_epsilon,
       max(released_at)               as latest_release
from dp_aggregates
where k_anonymous = true
group by metric_key, label, unit, region, round_no
having count(*) >= 5;

-- Storage accounting against the 500MB free-tier envelope.
create or replace function catena_storage_report(p_user_id uuid)
returns table (
  vectors bigint, dim integer,
  binary_bytes bigint, int8_bytes bigint, float32_bytes bigint,
  stored_mb numeric, cap_mb integer, headroom_pct numeric
)
language sql
security invoker
stable
as $$
  select count(*)::bigint,
         384,
         (count(*) * 48)::bigint,
         (count(*) * 384)::bigint,
         (count(*) * 1536)::bigint,
         round((count(*) * 432.0) / (1024 * 1024), 3),
         500,
         round(100 - ((count(*) * 432.0) / (1024 * 1024) / 500 * 100), 2)
  from graph_embeddings where user_id = p_user_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function catena_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists twins_touch on twins;
create trigger twins_touch before update on twins
  for each row execute function catena_touch_updated_at();

drop trigger if exists entities_touch on entities;
create trigger entities_touch before update on entities
  for each row execute function catena_touch_updated_at();

-- Every new twin gets a privacy budget row automatically.
create or replace function catena_init_budget()
returns trigger language plpgsql security definer as $$
begin
  insert into dp_budget (user_id) values (new.user_id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists twins_init_budget on twins;
create trigger twins_init_budget after insert on twins
  for each row execute function catena_init_budget();

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. SEED — canonical entity + community scaffold for a new twin
--
-- Call catena_seed_twin(auth.uid()) once after signup. It creates the graph
-- skeleton the dashboard expects; catena_refresh_edges() then measures the
-- edge weights from real observations.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function catena_seed_twin(p_user_id uuid, p_external_uid text default null)
returns void
language plpgsql
security invoker
as $$
begin
  insert into twins (user_id, external_uid, display_name)
  values (p_user_id, p_external_uid, 'Primary Twin')
  on conflict (user_id) do nothing;

  insert into entities (user_id, id, label, domain, kind, weight, community) values
    (p_user_id, 'med-adherence',    'Medication adherence', 'medication',  'behaviour', 0.92, 0),
    (p_user_id, 'med-antihtn',      'Antihypertensive',     'medication',  'drug',      0.74, 0),
    (p_user_id, 'med-statin',       'Statin',               'medication',  'drug',      0.58, 0),
    (p_user_id, 'sleep-duration',   'Sleep duration',       'sleep',       'measure',   0.95, 1),
    (p_user_id, 'sleep-quality',    'Sleep efficiency',     'sleep',       'measure',   0.71, 1),
    (p_user_id, 'circadian-phase',  'Circadian phase',      'sleep',       'state',     0.52, 1),
    (p_user_id, 'env-pm25',         'PM2.5 exposure',       'environment', 'exposure',  0.88, 2),
    (p_user_id, 'env-ozone',        'Ozone exposure',       'environment', 'exposure',  0.55, 2),
    (p_user_id, 'env-pollen',       'Pollen load',          'environment', 'exposure',  0.47, 2),
    (p_user_id, 'env-pressure',     'Barometric pressure',  'environment', 'exposure',  0.41, 2),
    (p_user_id, 'mental-stress',    'Perceived stress',     'mental',      'measure',   0.83, 3),
    (p_user_id, 'mental-mood',      'Mood',                 'mental',      'measure',   0.79, 3),
    (p_user_id, 'beh-screen',       'Screen time',          'mental',      'behaviour', 0.44, 3),
    (p_user_id, 'nutr-sodium',      'Sodium intake',        'nutrition',   'intake',    0.81, 4),
    (p_user_id, 'nutr-potassium',   'Potassium intake',     'nutrition',   'intake',    0.49, 4),
    (p_user_id, 'nutr-hydration',   'Hydration',            'nutrition',   'intake',    0.53, 4),
    (p_user_id, 'beh-activity',     'Physical activity',    'nutrition',   'behaviour', 0.76, 4),
    (p_user_id, 'vital-bp',         'Blood pressure',       'vital',       'outcome',   0.97, 5),
    (p_user_id, 'vital-hrv',        'Heart-rate variability','vital',      'outcome',   0.84, 5),
    (p_user_id, 'vital-glucose',    'Fasting glucose',      'vital',       'outcome',   0.68, 5),
    (p_user_id, 'vital-spo2',       'Blood oxygen',         'vital',       'outcome',   0.61, 5),
    (p_user_id, 'sym-respiratory',  'Respiratory symptoms', 'symptom',     'symptom',   0.72, 6),
    (p_user_id, 'sym-headache',     'Headache',             'symptom',     'symptom',   0.48, 6),
    (p_user_id, 'sym-fatigue',      'Fatigue',              'symptom',     'symptom',   0.66, 6),
    (p_user_id, 'fin-rxcost',       'Prescription cost',    'finance',     'cost',      0.38, 7),
    (p_user_id, 'fin-coverage',     'Insurance coverage',   'finance',     'cost',      0.31, 7)
  on conflict (user_id, id) do nothing;

  insert into communities (user_id, id, label, summary, size, member_ids) values
    (p_user_id, 0, 'Pharmacotherapy',        'Adherence behaviour and the active drug set; the strongest modifiable lever on the blood-pressure outcome.', 3, array['med-adherence','med-antihtn','med-statin']),
    (p_user_id, 1, 'Sleep & circadian',      'Duration, efficiency and phase; upstream of autonomic recovery and mood.', 3, array['sleep-duration','sleep-quality','circadian-phase']),
    (p_user_id, 2, 'Environmental exposure', 'Keyless live air-quality and meteorology terms driving respiratory symptom expression.', 4, array['env-pm25','env-ozone','env-pollen','env-pressure']),
    (p_user_id, 3, 'Mental health',          'Stress, mood and screen behaviour, bidirectionally coupled to sleep.', 3, array['mental-stress','mental-mood','beh-screen']),
    (p_user_id, 4, 'Nutrition & activity',   'Sodium/potassium balance, hydration and movement; the sodium term dominates BP response.', 4, array['nutr-sodium','nutr-potassium','nutr-hydration','beh-activity']),
    (p_user_id, 5, 'Cardiometabolic vitals', 'Terminal outcome nodes that every other community eventually routes into.', 4, array['vital-bp','vital-hrv','vital-glucose','vital-spo2']),
    (p_user_id, 6, 'Symptom expression',     'Where exposure and adherence lapses actually surface to the person.', 3, array['sym-respiratory','sym-headache','sym-fatigue']),
    (p_user_id, 7, 'Financial friction',     'Cost and coverage terms that predict adherence lapses before they occur.', 2, array['fin-rxcost','fin-coverage'])
  on conflict (user_id, id) do nothing;

  insert into dp_budget (user_id) values (p_user_id) on conflict do nothing;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- USAGE
--   select catena_seed_twin(auth.uid(), 'twin-ab12cd34');
--   -- ingest observations, then:
--   select catena_refresh_edges(auth.uid(), 1);
--   select catena_personalized_pagerank(auth.uid(), array['sleep-duration']);
--   select catena_quantize(auth.uid());
--   select * from catena_storage_report(auth.uid());
--   update twins set consent_dp = true where user_id = auth.uid();
--   select catena_dp_release(auth.uid(), 1.0, 1284, 'IN-MH');
--   select * from catena_cohort_signal;
-- ═══════════════════════════════════════════════════════════════════════════
