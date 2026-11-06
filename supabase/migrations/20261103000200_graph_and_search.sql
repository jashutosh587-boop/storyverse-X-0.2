-- STORYVERSE X · migration 2 · knowledge-graph edges, catalog helpers, search
--
-- All read access from the web app goes through the functions in this file and
-- in migration 4. They are SECURITY INVOKER, so Row Level Security still
-- applies to every table they touch.

-- ---------------------------------------------------------------------------
-- title_relations: directed edges between titles (the graph)
-- ---------------------------------------------------------------------------
create table public.title_relations (
  from_title_id  uuid not null references public.titles (id) on delete cascade,
  to_title_id    uuid not null references public.titles (id) on delete cascade,
  relation       text not null check (relation in (
                   'sequel','prequel','adapted_from','adapted_into','spin_off','side_story',
                   'parent_story','summary','full_story','alternative_version',
                   'alternative_setting','alternative_adaptation','same_franchise',
                   'same_universe','similar_story','shares_themes','inspired_by','inspired',
                   'character','other')),
  -- provider id ('jikan', ...) or 'editorial' / 'user'
  source         text not null,
  created_at     timestamptz not null default now(),
  primary key (from_title_id, to_title_id, relation),
  check (from_title_id <> to_title_id)
);
create index title_relations_to on public.title_relations (to_title_id);

alter table public.title_relations enable row level security;
create policy "graph is public" on public.title_relations for select to anon, authenticated using (true);
revoke all on public.title_relations from anon, authenticated;
grant select on public.title_relations to anon, authenticated;

-- ---------------------------------------------------------------------------
-- small pure helpers
-- ---------------------------------------------------------------------------
create or replace function public.inverse_relation(r text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'sequel'        then 'prequel'
    when 'prequel'       then 'sequel'
    when 'adapted_from'  then 'adapted_into'
    when 'adapted_into'  then 'adapted_from'
    when 'spin_off'      then 'parent_story'
    when 'side_story'    then 'parent_story'
    when 'parent_story'  then 'spin_off'
    when 'summary'       then 'full_story'
    when 'full_story'    then 'summary'
    when 'inspired_by'   then 'inspired'
    when 'inspired'      then 'inspired_by'
    else r
  end;
$$;

create or replace function public.relation_rank(r text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'prequel' then 1 when 'sequel' then 2 when 'parent_story' then 3
    when 'side_story' then 4 when 'spin_off' then 5 when 'adapted_from' then 6
    when 'adapted_into' then 7 when 'alternative_version' then 8
    when 'alternative_setting' then 9 when 'summary' then 10 when 'full_story' then 11
    else 20
  end;
$$;

-- What a user tracks, per medium: the unit and, when known, the total.
create or replace function public.progress_unit(p_media_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_media_type
    when 'anime' then 'episodes' when 'tv' then 'episodes' when 'movie' then 'viewing'
    when 'manga' then 'chapters' when 'comic' then 'chapters'
    when 'novel' then 'volumes'  when 'book' then 'pages'
  end;
$$;

create or replace function public.title_progress_total(t public.titles)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case t.media_type
    when 'anime' then t.episodes when 'tv' then t.episodes when 'movie' then 1
    when 'manga' then t.chapters when 'comic' then t.chapters
    when 'novel' then t.volumes  when 'book' then t.pages
  end;
$$;

-- The standard "card" shape every list in the app uses.
create or replace function public.title_card(t public.titles)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'title', t.title,
    'media_type', t.media_type,
    'format', t.format,
    'poster_url', t.poster_url,
    'release_year', t.release_year,
    'status', t.status,
    'provider_score', t.provider_score,
    'provider_score_count', t.provider_score_count,
    'provider_score_source', t.provider_score_source,
    'genres', t.genres,
    'episodes', t.episodes,
    'chapters', t.chapters,
    'volumes', t.volumes,
    'pages', t.pages,
    'runtime_minutes', t.runtime_minutes,
    'is_stub', t.is_stub
  );
$$;

-- ---------------------------------------------------------------------------
-- search_titles: one function powers search, browse and the home rails.
--
--   p_q  null  -> plain browse (sorted by p_sort)
--   p_q  text  -> prefix full-text match OR trigram match on the title, the
--                 original title or any alternative name (typo tolerant)
--
-- 'score' sorting uses a weighted rating so a 10.0 from three votes cannot
-- outrank an 8.7 from a million: (v*R + m*C) / (v + m), m = 100, C = 6.5.
-- ---------------------------------------------------------------------------
create or replace function public.search_titles(
  p_q            text     default null,
  p_media_types  text[]   default null,
  p_genres       text[]   default null,
  p_year_from    integer  default null,
  p_year_to      integer  default null,
  p_statuses     text[]   default null,
  p_min_score    numeric  default null,
  p_sort         text     default 'relevance',
  p_limit        integer  default 24,
  p_offset       integer  default 0
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_q       text := nullif(btrim(left(coalesce(p_q, ''), 200)), '');
  v_tokens  text[];
  v_tsq     tsquery;
  v_sort    text := coalesce(p_sort, 'relevance');
  v_limit   integer := least(greatest(coalesce(p_limit, 24), 1), 100);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_total   bigint;
  v_items   jsonb;
begin
  if v_sort not in ('relevance', 'popularity', 'score', 'newest', 'oldest', 'title') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  if v_q is null and v_sort = 'relevance' then
    v_sort := 'popularity';
  end if;

  if v_q is not null then
    v_tokens := array(
      select tok
      from unnest(regexp_split_to_array(lower(v_q), '[^[:alnum:]]+')) as tok
      where tok <> ''
    );
    if cardinality(v_tokens) > 0 then
      v_tsq := to_tsquery(
        'simple',
        array_to_string(array(select tok || ':*' from unnest(v_tokens) as tok), ' & ')
      );
    end if;
  end if;

  with matched as (
    select
      t.id,
      t.title,
      t.popularity,
      t.provider_score,
      coalesce(t.release_date, make_date(t.release_year::integer, 1, 1)) as sort_date,
      case
        when t.provider_score is null then null
        else (coalesce(t.provider_score_count, 0) * t.provider_score + 100 * 6.5)
             / (coalesce(t.provider_score_count, 0) + 100)
      end as weighted_score,
      case when v_q is null then 0::real else (
        coalesce(ts_rank_cd(t.search_vector, v_tsq), 0) * 2
        + greatest(
            similarity(t.title, v_q),
            similarity(coalesce(t.title_original, ''), v_q),
            coalesce(
              (select max(similarity(a.name, v_q))
                 from public.title_alt_names a
                where a.title_id = t.id),
              0)
          ) * 1.5
        + case when lower(t.title) = lower(v_q) then 2 else 0 end
      )::real end as rank
    from public.titles t
    where not t.is_stub
      and (p_media_types is null or t.media_type = any (p_media_types))
      and (p_genres      is null or t.genres && p_genres)
      and (p_year_from   is null or t.release_year >= p_year_from)
      and (p_year_to     is null or t.release_year <= p_year_to)
      and (p_statuses    is null or t.status = any (p_statuses))
      and (p_min_score   is null or t.provider_score >= p_min_score)
      and (
        v_q is null
        or (v_tsq is not null and t.search_vector @@ v_tsq)
        or t.title % v_q
        or t.title_original % v_q
        or exists (select 1 from public.title_alt_names a where a.title_id = t.id and a.name % v_q)
      )
  ),
  numbered as (
    select
      m.id,
      row_number() over (
        order by
          case when v_sort = 'relevance'  then m.rank           end desc nulls last,
          case when v_sort = 'popularity' then m.popularity     end desc nulls last,
          case when v_sort = 'score'      then m.weighted_score end desc nulls last,
          case when v_sort = 'newest'     then m.sort_date      end desc nulls last,
          case when v_sort = 'oldest'     then m.sort_date      end asc  nulls last,
          case when v_sort = 'title'      then m.title          end asc,
          m.popularity desc nulls last,
          m.title asc,
          m.id asc
      ) as ord
    from matched m
  )
  select
    (select count(*) from numbered),
    coalesce(jsonb_agg(public.title_card(t) order by n.ord), '[]'::jsonb)
  into v_total, v_items
  from numbered n
  join public.titles t on t.id = n.id
  where n.ord > v_offset and n.ord <= v_offset + v_limit;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
end;
$$;

-- Autocomplete: compact results for a query of at least two characters.
create or replace function public.suggest_titles(p_q text, p_limit integer default 8)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', i ->> 'slug',
           'title', i ->> 'title',
           'media_type', i ->> 'media_type',
           'release_year', i -> 'release_year',
           'poster_url', i -> 'poster_url')), '[]'::jsonb)
  from jsonb_array_elements(
    case
      when length(btrim(coalesce(p_q, ''))) >= 2 then
        public.search_titles(p_q, null, null, null, null, null, null, 'relevance',
                             least(greatest(coalesce(p_limit, 8), 1), 12), 0) -> 'items'
      else '[]'::jsonb
    end
  ) as i;
$$;

-- Filter options for a browse page.
create or replace function public.title_facets(p_media_types text[] default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select * from public.titles
    where not is_stub and (p_media_types is null or media_type = any (p_media_types))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'genres', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name, 'count', g.n) order by g.n desc, g.name)
      from (
        select x.name, count(*) as n
        from base b, unnest(b.genres) as x(name)
        group by x.name
        order by count(*) desc, x.name
        limit 60
      ) g
    ), '[]'::jsonb),
    'years', jsonb_build_object(
      'min', (select min(release_year) from base),
      'max', (select max(release_year) from base)
    ),
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.status, 'count', s.n) order by s.n desc, s.status)
      from (select status, count(*) as n from base group by status) s
    ), '[]'::jsonb)
  );
$$;

-- "More like this" by shared genres and themes (Jaccard overlap). This is a
-- transparent content-based signal, not a learned recommendation.
create or replace function public.similar_titles_by_tags(p_title_id uuid, p_limit integer default 12)
returns jsonb
language sql
stable
set search_path = public
as $$
  with target as (
    select id, genres, themes, (genres || themes) as tags
    from public.titles
    where id = p_title_id and not is_stub
  ),
  scored as (
    select
      c.id,
      c.provider_score,
      c.title,
      array(
        select distinct x from unnest(c.genres || c.themes) as x where x = any (t.tags) order by x
      ) as shared,
      cardinality(array(select distinct x from unnest(c.genres || c.themes || t.tags) as x)) as total
    from target t
    join public.titles c
      on c.id <> t.id
     and not c.is_stub
     and (c.genres && t.genres or c.themes && t.themes)
  ),
  ranked as (
    select s.*, round(cardinality(s.shared)::numeric / nullif(s.total, 0), 3) as similarity
    from scored s
    where cardinality(s.shared) > 0
    order by similarity desc, s.provider_score desc nulls last, s.title
    limit least(greatest(coalesce(p_limit, 12), 1), 50)
  )
  select coalesce(jsonb_agg(
           public.title_card(t) || jsonb_build_object('similarity', r.similarity, 'shared_tags', r.shared)
           order by r.similarity desc, r.provider_score desc nulls last, r.title), '[]'::jsonb)
  from ranked r
  join public.titles t on t.id = r.id;
$$;

grant execute on function public.search_titles(text, text[], text[], integer, integer, text[], numeric, text, integer, integer) to anon, authenticated;
grant execute on function public.suggest_titles(text, integer)                 to anon, authenticated;
grant execute on function public.title_facets(text[])                          to anon, authenticated;
grant execute on function public.similar_titles_by_tags(uuid, integer)         to anon, authenticated;
