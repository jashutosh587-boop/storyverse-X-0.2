-- STORYVERSE X · migration 5 · ingestion bookkeeping and data-quality views
--
-- Operational tables. Nothing here is reachable by anonymous or signed-in
-- visitors: RLS is on with no policies, and privileges are revoked.

create table public.ingestion_runs (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  job              text not null,
  params           jsonb not null default '{}'::jsonb,
  status           text not null default 'running'
                   check (status in ('running','succeeded','partial','failed')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  items_seen       integer not null default 0,
  items_inserted   integer not null default 0,
  items_updated    integer not null default 0,
  items_unchanged  integer not null default 0,
  items_failed     integer not null default 0,
  -- where to resume if the run stopped early, e.g. {"page": 7}
  cursor           jsonb,
  error            text
);
create index ingestion_runs_lookup on public.ingestion_runs (provider, job, started_at desc);

create table public.ingestion_errors (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references public.ingestion_runs (id) on delete cascade,
  external_id  text,
  message      text not null,
  created_at   timestamptz not null default now()
);
create index ingestion_errors_run on public.ingestion_errors (run_id);

alter table public.ingestion_runs   enable row level security;
alter table public.ingestion_errors enable row level security;
revoke all on public.ingestion_runs, public.ingestion_errors from anon, authenticated;

-- Pairs of visible titles that look like the same work. Candidates only:
-- nothing is merged automatically, an editor decides.
create view public.duplicate_title_candidates
with (security_invoker = true) as
select a.id as title_a, b.id as title_b, a.media_type, a.title, a.release_year
from public.titles a
join public.titles b
  on a.media_type = b.media_type
 and lower(a.title) = lower(b.title)
 and a.release_year is not distinct from b.release_year
 and a.id < b.id
where not a.is_stub and not b.is_stub;

revoke all on public.duplicate_title_candidates from anon, authenticated;
