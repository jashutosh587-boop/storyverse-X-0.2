-- STORYVERSE X · migration 8 · official watch links, licensed episodes and private playback progress
--
-- IMPORTANT:
--   * Watch links are curated HTTPS links to official provider pages.
--   * Built-in playback is exposed only for published episodes with an explicit
--     rights-holder confirmation and an HTTPS HLS/MP4 source.
--   * The public anon key cannot add, edit or remove provider/episode records.
--   * Per-user watch progress is private and protected by RLS.

create table public.watch_catalog_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.watch_catalog_admins enable row level security;
revoke all on public.watch_catalog_admins from public, anon, authenticated;

create or replace function public.is_watch_catalog_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.watch_catalog_admins a
    where a.user_id = auth.uid()
  );
$$;
revoke all on function public.is_watch_catalog_admin() from public, anon;
grant execute on function public.is_watch_catalog_admin() to authenticated;

create table public.title_watch_links (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.titles (id) on delete cascade,
  provider_name text not null check (char_length(btrim(provider_name)) between 2 and 60),
  url text not null check (url ~ '^https://'),
  country_code text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  availability text not null default 'unknown'
    check (availability in ('subscription', 'free', 'ads', 'rent', 'buy', 'unknown')),
  audio_languages text[] not null default '{}',
  subtitle_languages text[] not null default '{}',
  is_official boolean not null default false,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title_id, provider_name, country_code)
);
create index title_watch_links_title_active on public.title_watch_links (title_id, country_code) where is_active and is_official;
create trigger title_watch_links_set_updated_at
  before update on public.title_watch_links
  for each row execute function public.set_updated_at();

create table public.title_episodes (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.titles (id) on delete cascade,
  season_number integer not null default 1 check (season_number between 1 and 999),
  episode_number integer not null check (episode_number between 1 and 99999),
  episode_title text not null check (char_length(btrim(episode_title)) between 1 and 160),
  synopsis text check (char_length(synopsis) <= 3000),
  runtime_seconds integer check (runtime_seconds is null or runtime_seconds between 1 and 86400),
  stream_url text,
  stream_type text check (stream_type is null or stream_type in ('hls', 'mp4')),
  rights_holder text,
  license_reference text,
  license_confirmed boolean not null default false,
  license_confirmed_at timestamptz,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title_id, season_number, episode_number),
  check (
    (stream_url is null and stream_type is null)
    or (stream_url ~ '^https://' and stream_type in ('hls', 'mp4'))
  ),
  check (
    not is_published
    or (
      license_confirmed
      and stream_url is not null
      and rights_holder is not null
      and char_length(btrim(rights_holder)) > 0
      and license_confirmed_at is not null
    )
  )
);
create index title_episodes_title_order on public.title_episodes (title_id, season_number, episode_number);
create trigger title_episodes_set_updated_at
  before update on public.title_episodes
  for each row execute function public.set_updated_at();

create table public.watch_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete cascade,
  episode_id uuid not null references public.title_episodes (id) on delete cascade,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, episode_id),
  check (position_seconds <= duration_seconds)
);
create index watch_progress_user_updated on public.watch_progress (user_id, updated_at desc);
create trigger watch_progress_set_updated_at
  before update on public.watch_progress
  for each row execute function public.set_updated_at();

alter table public.title_watch_links enable row level security;
alter table public.title_episodes enable row level security;
alter table public.watch_progress enable row level security;

create policy "public reads curated official watch links"
  on public.title_watch_links for select to anon, authenticated
  using (is_active and is_official);
create policy "watch admins manage provider links"
  on public.title_watch_links for all to authenticated
  using (public.is_watch_catalog_admin())
  with check (public.is_watch_catalog_admin());

create policy "public reads published licensed episodes"
  on public.title_episodes for select to anon, authenticated
  using (is_published and license_confirmed);
create policy "watch admins manage licensed episodes"
  on public.title_episodes for all to authenticated
  using (public.is_watch_catalog_admin())
  with check (public.is_watch_catalog_admin());

create policy "members read their own watch progress"
  on public.watch_progress for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.title_watch_links, public.title_episodes, public.watch_progress from public, anon, authenticated;
grant select on public.title_watch_links, public.title_episodes to anon, authenticated;
grant select on public.watch_progress to anon, authenticated;

-- One public read returns official platform links, licensed playable episodes,
-- and only the signed-in viewer's own progress (the progress table RLS applies).
create or replace function public.get_watch_catalog(p_title_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'provider_name', w.provider_name,
        'url', w.url,
        'country_code', w.country_code,
        'availability', w.availability,
        'audio_languages', w.audio_languages,
        'subtitle_languages', w.subtitle_languages,
        'verified_at', w.verified_at
      ) order by w.provider_name)
      from public.title_watch_links w
      where w.title_id = t.id and w.is_active and w.is_official
    ), '[]'::jsonb),
    'episodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'season_number', e.season_number,
        'episode_number', e.episode_number,
        'episode_title', e.episode_title,
        'synopsis', e.synopsis,
        'runtime_seconds', e.runtime_seconds,
        'stream_url', e.stream_url,
        'stream_type', e.stream_type,
        'position_seconds', coalesce(wp.position_seconds, 0),
        'duration_seconds', wp.duration_seconds,
        'completed', coalesce(wp.completed, false)
      ) order by e.season_number, e.episode_number)
      from public.title_episodes e
      left join public.watch_progress wp
        on wp.episode_id = e.id and wp.user_id = auth.uid()
      where e.title_id = t.id and e.is_published and e.license_confirmed
    ), '[]'::jsonb)
  )
  from public.titles t
  where t.id = p_title_id and not t.is_stub;
$$;

create or replace function public.save_watch_progress(
  p_title_id uuid,
  p_episode_id uuid,
  p_position_seconds integer,
  p_duration_seconds integer,
  p_completed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_position integer;
  v_row public.watch_progress;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_position_seconds is null or p_position_seconds < 0
     or p_duration_seconds is null or p_duration_seconds < 1 or p_duration_seconds > 86400 then
    raise exception 'invalid_watch_position' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.title_episodes e
    where e.id = p_episode_id
      and e.title_id = p_title_id
      and e.is_published
      and e.license_confirmed
  ) then
    raise exception 'episode_not_available' using errcode = 'P0002';
  end if;

  v_position := least(p_position_seconds, p_duration_seconds);
  insert into public.watch_progress as wp
    (user_id, title_id, episode_id, position_seconds, duration_seconds, completed)
  values
    (v_user_id, p_title_id, p_episode_id, v_position, p_duration_seconds,
     coalesce(p_completed, false) or v_position >= greatest(0, p_duration_seconds - 15))
  on conflict (user_id, episode_id) do update set
    title_id = excluded.title_id,
    position_seconds = excluded.position_seconds,
    duration_seconds = excluded.duration_seconds,
    completed = wp.completed or excluded.completed
  returning * into v_row;

  return jsonb_build_object(
    'episode_id', v_row.episode_id,
    'position_seconds', v_row.position_seconds,
    'duration_seconds', v_row.duration_seconds,
    'completed', v_row.completed,
    'updated_at', v_row.updated_at
  );
end;
$$;

-- Admin-only upserts. Public/anon users cannot call these functions.
create or replace function public.upsert_watch_provider(
  p_title_id uuid,
  p_provider_name text,
  p_url text,
  p_country_code text default 'IN',
  p_availability text default 'unknown',
  p_audio_languages text[] default '{}',
  p_subtitle_languages text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_country text := upper(coalesce(p_country_code, 'IN'));
  v_availability text := coalesce(p_availability, 'unknown');
begin
  if not public.is_watch_catalog_admin() then
    raise exception 'not_watch_admin' using errcode = '42501';
  end if;
  if p_provider_name is null or char_length(btrim(p_provider_name)) not between 2 and 60
     or p_url is null or p_url !~ '^https://'
     or v_country !~ '^[A-Z]{2}$'
     or v_availability not in ('subscription', 'free', 'ads', 'rent', 'buy', 'unknown') then
    raise exception 'invalid_watch_provider' using errcode = '22023';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and not t.is_stub) then
    raise exception 'title_not_found' using errcode = 'P0002';
  end if;

  insert into public.title_watch_links as w
    (title_id, provider_name, url, country_code, availability,
     audio_languages, subtitle_languages, is_official, is_active, verified_at)
  values
    (p_title_id, btrim(p_provider_name), p_url, v_country, v_availability,
     coalesce(p_audio_languages, '{}'), coalesce(p_subtitle_languages, '{}'), true, true, now())
  on conflict (title_id, provider_name, country_code) do update set
    url = excluded.url,
    availability = excluded.availability,
    audio_languages = excluded.audio_languages,
    subtitle_languages = excluded.subtitle_languages,
    is_official = true,
    is_active = true,
    verified_at = now()
  returning w.id into v_id;
  return v_id;
end;
$$;

create or replace function public.upsert_watch_episode(
  p_title_id uuid,
  p_season_number integer,
  p_episode_number integer,
  p_episode_title text,
  p_runtime_seconds integer,
  p_stream_url text,
  p_stream_type text,
  p_rights_holder text,
  p_license_reference text default null,
  p_confirmed_rights boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_watch_catalog_admin() then
    raise exception 'not_watch_admin' using errcode = '42501';
  end if;
  if not coalesce(p_confirmed_rights, false) then
    raise exception 'rights_confirmation_required' using errcode = '22023';
  end if;
  if p_episode_title is null or char_length(btrim(p_episode_title)) not between 1 and 160
     or p_season_number is null or p_season_number not between 1 and 999
     or p_episode_number is null or p_episode_number not between 1 and 99999
     or p_runtime_seconds is not null and p_runtime_seconds not between 1 and 86400
     or p_stream_url is null or p_stream_url !~ '^https://'
     or p_stream_type not in ('hls', 'mp4')
     or p_rights_holder is null or char_length(btrim(p_rights_holder)) = 0 then
    raise exception 'invalid_watch_episode' using errcode = '22023';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and not t.is_stub) then
    raise exception 'title_not_found' using errcode = 'P0002';
  end if;

  insert into public.title_episodes as e
    (title_id, season_number, episode_number, episode_title, runtime_seconds,
     stream_url, stream_type, rights_holder, license_reference,
     license_confirmed, license_confirmed_at, is_published)
  values
    (p_title_id, p_season_number, p_episode_number, btrim(p_episode_title), p_runtime_seconds,
     p_stream_url, p_stream_type, btrim(p_rights_holder), nullif(btrim(p_license_reference), ''),
     true, now(), true)
  on conflict (title_id, season_number, episode_number) do update set
    episode_title = excluded.episode_title,
    runtime_seconds = excluded.runtime_seconds,
    stream_url = excluded.stream_url,
    stream_type = excluded.stream_type,
    rights_holder = excluded.rights_holder,
    license_reference = excluded.license_reference,
    license_confirmed = true,
    license_confirmed_at = now(),
    is_published = true
  returning e.id into v_id;
  return v_id;
end;
$$;

revoke all on function public.get_watch_catalog(uuid) from public, anon, authenticated;
revoke all on function public.save_watch_progress(uuid, uuid, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.upsert_watch_provider(uuid, text, text, text, text, text[], text[]) from public, anon, authenticated;
revoke all on function public.upsert_watch_episode(uuid, integer, integer, text, integer, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.get_watch_catalog(uuid) to anon, authenticated;
grant execute on function public.save_watch_progress(uuid, uuid, integer, integer, boolean) to authenticated;
grant execute on function public.upsert_watch_provider(uuid, text, text, text, text, text[], text[]) to authenticated;
grant execute on function public.upsert_watch_episode(uuid, integer, integer, text, integer, text, text, text, text, boolean) to authenticated;
