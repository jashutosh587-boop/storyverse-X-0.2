-- STORYVERSE X · migration 1 · core catalog
--
-- The catalog is public, read-only data. It is written only by the ingestion
-- pipeline (database owner / service role) and by future editorial tooling,
-- never by anonymous or signed-in visitors.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- titles: one row per work, whatever the medium
-- ---------------------------------------------------------------------------
create table public.titles (
  id                    uuid primary key default gen_random_uuid(),
  media_type            text not null
                        check (media_type in ('anime','movie','tv','book','novel','manga','comic')),
  format                text,
  slug                  text not null unique,
  title                 text not null check (btrim(title) <> ''),
  title_original        text,
  synopsis              text,
  status                text not null default 'unknown'
                        check (status in ('announced','upcoming','releasing','finished','hiatus','cancelled','unknown')),
  release_date          date,
  end_date              date,
  release_year          smallint check (release_year between 1 and 3000),
  season                text check (season in ('winter','spring','summer','fall')),
  season_year           smallint,
  country               text,
  language              text,
  episodes              integer check (episodes >= 0),
  runtime_minutes       integer check (runtime_minutes >= 0),
  pages                 integer check (pages >= 0),
  volumes               integer check (volumes >= 0),
  chapters              integer check (chapters >= 0),
  age_rating            text,
  genres                text[] not null default '{}',
  themes                text[] not null default '{}',
  poster_url            text,
  backdrop_url          text,
  -- Score reported by the metadata provider on a 0-10 scale. This is NOT the
  -- Storyverse community score; the UI always labels it with its source.
  provider_score        numeric(4,2) check (provider_score between 0 and 10),
  provider_score_count  integer check (provider_score_count >= 0),
  provider_score_source text,
  -- Provider-specific popularity magnitude (higher = more popular). Only
  -- comparable between titles from the same provider.
  popularity            real,
  -- A stub is a placeholder created when another title points at it (a
  -- sequel, an adaptation). It is hidden from browse/search until ingested.
  is_stub               boolean not null default false,
  search_vector         tsvector generated always as (
      setweight(to_tsvector('simple',  coalesce(title, '')),          'A') ||
      setweight(to_tsvector('simple',  coalesce(title_original, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(synopsis, '')),       'C')
  ) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger titles_set_updated_at
  before update on public.titles
  for each row execute function public.set_updated_at();

create index titles_browse_idx      on public.titles (media_type, release_year desc)            where not is_stub;
create index titles_score_idx       on public.titles (media_type, provider_score desc nulls last) where not is_stub;
create index titles_popularity_idx  on public.titles (media_type, popularity desc nulls last)    where not is_stub;
create index titles_genres_gin      on public.titles using gin (genres);
create index titles_themes_gin      on public.titles using gin (themes);
create index titles_search_gin      on public.titles using gin (search_vector);
create index titles_title_trgm      on public.titles using gin (title extensions.gin_trgm_ops);
create index titles_original_trgm   on public.titles using gin (title_original extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- alternative and translated names, for multilingual and typo-tolerant search
-- ---------------------------------------------------------------------------
create table public.title_alt_names (
  id        bigint generated always as identity primary key,
  title_id  uuid not null references public.titles (id) on delete cascade,
  name      text not null check (btrim(name) <> ''),
  lang      text,
  kind      text not null default 'synonym'
            check (kind in ('synonym','translated','romanized','native')),
  unique (title_id, name)
);
create index title_alt_names_title on public.title_alt_names (title_id);
create index title_alt_names_trgm  on public.title_alt_names using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- provenance: which provider record produced (or enriched) a title
-- ---------------------------------------------------------------------------
create table public.title_sources (
  provider      text not null
                check (provider in ('jikan','tmdb','openlibrary','googlebooks','editorial','user')),
  external_id   text not null,
  title_id      uuid not null references public.titles (id) on delete cascade,
  url           text,
  attribution   text,
  payload_hash  text,
  fetched_at    timestamptz not null default now(),
  primary key (provider, external_id)
);
create index title_sources_title on public.title_sources (title_id);

-- ---------------------------------------------------------------------------
-- contributors: people, studios, publishers
-- ---------------------------------------------------------------------------
create table public.contributors (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('person','studio','publisher','company')),
  slug           text not null unique,
  name           text not null check (btrim(name) <> ''),
  name_original  text,
  image_url      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger contributors_set_updated_at
  before update on public.contributors
  for each row execute function public.set_updated_at();
create index contributors_name_trgm on public.contributors using gin (name extensions.gin_trgm_ops);

create table public.contributor_sources (
  provider        text not null
                  check (provider in ('jikan','tmdb','openlibrary','googlebooks','editorial','user')),
  external_id     text not null,
  contributor_id  uuid not null references public.contributors (id) on delete cascade,
  url             text,
  primary key (provider, external_id)
);
create index contributor_sources_contributor on public.contributor_sources (contributor_id);

create table public.title_contributors (
  title_id        uuid not null references public.titles (id) on delete cascade,
  contributor_id  uuid not null references public.contributors (id) on delete cascade,
  role            text not null check (btrim(role) <> ''),
  billing_order   smallint,
  -- the provider that asserted this credit, so re-ingestion can replace it
  source          text not null,
  primary key (title_id, contributor_id, role)
);
create index title_contributors_contributor on public.title_contributors (contributor_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: the catalog is world-readable and not writable through
-- the public API. Writes bypass RLS (table owner / service role).
-- ---------------------------------------------------------------------------
alter table public.titles               enable row level security;
alter table public.title_alt_names      enable row level security;
alter table public.title_sources        enable row level security;
alter table public.contributors         enable row level security;
alter table public.contributor_sources  enable row level security;
alter table public.title_contributors   enable row level security;

create policy "catalog is public" on public.titles              for select to anon, authenticated using (true);
create policy "catalog is public" on public.title_alt_names     for select to anon, authenticated using (true);
create policy "catalog is public" on public.title_sources       for select to anon, authenticated using (true);
create policy "catalog is public" on public.contributors        for select to anon, authenticated using (true);
create policy "catalog is public" on public.contributor_sources for select to anon, authenticated using (true);
create policy "catalog is public" on public.title_contributors  for select to anon, authenticated using (true);

revoke all on public.titles, public.title_alt_names, public.title_sources,
              public.contributors, public.contributor_sources, public.title_contributors
  from anon, authenticated;
grant select on public.titles, public.title_alt_names, public.title_sources,
                public.contributors, public.contributor_sources, public.title_contributors
  to anon, authenticated;
