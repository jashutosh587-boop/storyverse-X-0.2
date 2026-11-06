-- STORYVERSE X · migration 4 · SQL API
--
-- The web app talks to the database only through these functions. They are
-- SECURITY INVOKER (Row Level Security applies), validate their input, and
-- raise short machine-readable error messages the app maps to user text.

-- ---------------------------------------------------------------------------
-- get_title: everything the title page needs in one round trip
-- ---------------------------------------------------------------------------
create or replace function public.get_title(p_slug text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', public.title_card(t) || jsonb_build_object(
      'title_original', t.title_original,
      'synopsis', t.synopsis,
      'release_date', t.release_date,
      'end_date', t.end_date,
      'season', t.season,
      'season_year', t.season_year,
      'country', t.country,
      'language', t.language,
      'age_rating', t.age_rating,
      'themes', t.themes,
      'backdrop_url', t.backdrop_url,
      'progress_unit', public.progress_unit(t.media_type),
      'progress_total', public.title_progress_total(t)
    ),
    'alt_names', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'lang', a.lang, 'kind', a.kind) order by a.name)
      from public.title_alt_names a
      where a.title_id = t.id
    ), '[]'::jsonb),
    'contributors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'slug', c.slug, 'name', c.name, 'kind', c.kind, 'role', tc.role)
             order by tc.billing_order nulls last, c.name)
      from public.title_contributors tc
      join public.contributors c on c.id = tc.contributor_id
      where tc.title_id = t.id
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', s.provider, 'external_id', s.external_id, 'url', s.url,
               'attribution', s.attribution, 'fetched_at', s.fetched_at)
             order by s.provider)
      from public.title_sources s
      where s.title_id = t.id
    ), '[]'::jsonb),
    'relations', coalesce((
      with edges as (
        select r.relation, r.to_title_id as other_id
          from public.title_relations r where r.from_title_id = t.id
        union
        select public.inverse_relation(r.relation), r.from_title_id
          from public.title_relations r where r.to_title_id = t.id
      )
      select jsonb_agg(
               jsonb_build_object('relation', e.relation, 'title', public.title_card(o))
               order by public.relation_rank(e.relation), o.title)
      from edges e
      join public.titles o on o.id = e.other_id
    ), '[]'::jsonb),
    'community', public.title_rating_summary(t.id)
  )
  from public.titles t
  where t.slug = p_slug and not t.is_stub;
$$;

-- ---------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------
create or replace function public.get_library_entry(p_title_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(e) - 'user_id'
  from public.library_entries e
  where e.user_id = auth.uid() and e.title_id = p_title_id;
$$;

-- Create or update the caller's entry. Null arguments mean "leave as is".
--
-- Rules enforced here (and covered by tests):
--   * progress can never exceed the known total (episodes, chapters, pages...)
--   * marking an entry completed sets progress to the total, when known
--   * reaching the total while in progress marks the entry completed
--   * started_at / completed_at are stamped once, on the first transition
create or replace function public.upsert_library_entry(
  p_title_id      uuid,
  p_status        text     default null,
  p_progress      integer  default null,
  p_rating        integer  default null,
  p_clear_rating  boolean  default false,
  p_notes         text     default null,
  p_is_private    boolean  default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_title     public.titles;
  v_old       public.library_entries;
  v_total     integer;
  v_status    text;
  v_progress  integer;
  v_rating    smallint;
  v_row       public.library_entries;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_title from public.titles where id = p_title_id and not is_stub;
  if not found then
    raise exception 'title_not_found' using errcode = 'P0002';
  end if;

  select * into v_old from public.library_entries where user_id = v_uid and title_id = p_title_id;

  v_total    := public.title_progress_total(v_title);
  v_status   := coalesce(p_status, v_old.status, 'planned');
  v_progress := coalesce(p_progress, v_old.progress, 0);

  if v_status not in ('planned','in_progress','completed','paused','dropped','repeating') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if v_progress < 0 then
    raise exception 'invalid_progress' using errcode = '22023';
  end if;
  if v_total is not null and v_progress > v_total then
    raise exception 'progress_exceeds_total' using errcode = '22003';
  end if;

  if v_status = 'completed' and v_total is not null then
    v_progress := v_total;
  end if;
  if v_status = 'in_progress' and v_total is not null and v_total > 0 and v_progress >= v_total then
    v_status := 'completed';
  end if;

  if p_clear_rating then
    v_rating := null;
  elsif p_rating is not null then
    if p_rating not between 1 and 10 then
      raise exception 'invalid_rating' using errcode = '22023';
    end if;
    v_rating := p_rating;
  else
    v_rating := v_old.rating;
  end if;

  insert into public.library_entries as e
    (user_id, title_id, status, progress, rating, notes, is_private, started_at, completed_at)
  values (
    v_uid, p_title_id, v_status, v_progress, v_rating,
    nullif(btrim(p_notes), ''),
    coalesce(p_is_private, false),
    case when v_status <> 'planned' or v_progress > 0 then current_date end,
    case when v_status = 'completed' then current_date end
  )
  on conflict (user_id, title_id) do update set
    status       = excluded.status,
    progress     = excluded.progress,
    rating       = excluded.rating,
    notes        = case when p_notes is not null then nullif(btrim(p_notes), '') else e.notes end,
    is_private   = coalesce(p_is_private, e.is_private),
    started_at   = coalesce(e.started_at, excluded.started_at),
    completed_at = case when excluded.status = 'completed'
                        then coalesce(e.completed_at, current_date)
                        else e.completed_at end
  returning * into v_row;

  return to_jsonb(v_row) - 'user_id';
end;
$$;

create or replace function public.remove_library_entry(p_title_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from public.library_entries where user_id = auth.uid() and title_id = p_title_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- A user's library. With no user id it returns the caller's own. RLS decides
-- which entries a viewer may see; notes are only ever returned to the owner.
create or replace function public.list_library(
  p_user_id  uuid     default null,
  p_status   text     default null,
  p_limit    integer  default 200,
  p_offset   integer  default 0
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_user    uuid := coalesce(p_user_id, auth.uid());
  v_limit   integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_total   bigint;
  v_counts  jsonb;
  v_items   jsonb;
begin
  if v_user is null then
    return jsonb_build_object('total', 0, 'counts', '{}'::jsonb, 'items', '[]'::jsonb);
  end if;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
    into v_counts
    from (select status, count(*) as n
            from public.library_entries
           where user_id = v_user
           group by status) s;

  select count(*) into v_total
    from public.library_entries e
   where e.user_id = v_user and (p_status is null or e.status = p_status);

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'entry', case when p.user_id = auth.uid()
                           then to_jsonb(p) - 'user_id'
                           else to_jsonb(p) - 'user_id' - 'notes' end,
             'title', public.title_card(t),
             'progress_unit', public.progress_unit(t.media_type),
             'progress_total', public.title_progress_total(t))
           order by p.updated_at desc, t.title), '[]'::jsonb)
    into v_items
    from (
      select e.*
        from public.library_entries e
       where e.user_id = v_user and (p_status is null or e.status = p_status)
       order by e.updated_at desc
       limit v_limit offset v_offset
    ) p
    join public.titles t on t.id = p.title_id;

  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create or replace function public.get_profile(p_username text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'bio', p.bio,
    'avatar_url', p.avatar_url,
    'is_public', p.is_public,
    -- auth.uid() is null for a signed-out visitor, and null = anything is null, not false.
    'is_self', coalesce(p.id = auth.uid(), false),
    'created_at', p.created_at
  )
  from public.profiles p
  where case when p_username is null
             then p.id = auth.uid()
             else lower(p.username) = lower(p_username) end;
$$;

create or replace function public.update_my_profile(
  p_username      text     default null,
  p_display_name  text     default null,
  p_bio           text     default null,
  p_is_public     boolean  default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_username is not null and p_username !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;

  begin
    update public.profiles
       set username     = coalesce(p_username, username),
           display_name = case when p_display_name is null then display_name
                               else nullif(btrim(p_display_name), '') end,
           bio          = case when p_bio is null then bio
                               else nullif(btrim(p_bio), '') end,
           is_public    = coalesce(p_is_public, is_public)
     where id = v_uid;
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;

  return public.get_profile(null);
end;
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_username ~ '^[A-Za-z0-9_]{3,24}$', false)
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(p_username));
$$;

-- Everything the app stores about the caller, as one JSON document.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', public.get_profile(null),
    'library', coalesce((
      select jsonb_agg(
               (to_jsonb(e) - 'user_id')
               || jsonb_build_object('title', t.title, 'media_type', t.media_type, 'title_slug', t.slug)
               order by e.updated_at desc)
      from public.library_entries e
      join public.titles t on t.id = e.title_id
      where e.user_id = auth.uid()
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. Postgres grants EXECUTE to PUBLIC by default, so revoke
-- first, then grant explicitly.
-- ---------------------------------------------------------------------------
revoke all on function
  public.get_title(text),
  public.get_library_entry(uuid),
  public.upsert_library_entry(uuid, text, integer, integer, boolean, text, boolean),
  public.remove_library_entry(uuid),
  public.list_library(uuid, text, integer, integer),
  public.get_profile(text),
  public.update_my_profile(text, text, text, boolean),
  public.username_available(text),
  public.export_my_data()
from public, anon, authenticated;

grant execute on function
  public.get_title(text),
  public.get_library_entry(uuid),
  public.list_library(uuid, text, integer, integer),
  public.get_profile(text),
  public.username_available(text)
to anon, authenticated;

grant execute on function
  public.upsert_library_entry(uuid, text, integer, integer, boolean, text, boolean),
  public.remove_library_entry(uuid),
  public.update_my_profile(text, text, text, boolean),
  public.export_my_data()
to authenticated;
