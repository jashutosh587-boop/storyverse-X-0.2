-- STORYVERSE X · migration 7 · private notes, and small fixes found in review
--
-- 1. Notes leave library_entries.
--
--    library_entries is readable by anyone for the entries of a public profile that
--    are not marked private: that is how a public profile works. Row-level security
--    decides which ROWS a reader gets, and cannot hide one column of a row it lets
--    through. The SQL functions already left notes out for everybody but the owner,
--    but the table itself would have handed them to anyone who queried it directly
--    (for example with the project's anon key). Notes now live in their own table,
--    which only the owner can read or write, so the rule holds at the table too.
--
-- 2. Signing up can no longer fail because two people picked the same username at
--    the same moment.
-- 3. Nothing in the app sets avatar_url, so signed-in users lose the right to write it.
-- 4. A library listing now has a total order, so paging cannot repeat or skip entries
--    that share a timestamp.

-- ---------------------------------------------------------------------------
-- 1. library_notes
-- ---------------------------------------------------------------------------
create table public.library_notes (
  user_id     uuid not null,
  title_id    uuid not null,
  notes       text not null check (char_length(notes) between 1 and 2000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, title_id),
  foreign key (user_id, title_id)
    references public.library_entries (user_id, title_id) on delete cascade
);

create trigger library_notes_set_updated_at
  before update on public.library_notes
  for each row execute function public.set_updated_at();

alter table public.library_notes enable row level security;

create policy "owner reads own notes"
  on public.library_notes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "owner adds own notes"
  on public.library_notes for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner edits own notes"
  on public.library_notes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner deletes own notes"
  on public.library_notes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Visitors who are not signed in get no access to this table at all.
revoke all on public.library_notes from anon, authenticated;
grant select, insert, update, delete on public.library_notes to authenticated;

-- Carry over any notes that already exist, then drop the old column (and with it
-- its length check).
insert into public.library_notes (user_id, title_id, notes)
select user_id, title_id, btrim(notes, E' \t\r\n')
  from public.library_entries
 where notes is not null and btrim(notes, E' \t\r\n') <> '';

alter table public.library_entries drop column notes;

-- ---------------------------------------------------------------------------
-- Functions that used to read or write library_entries.notes
--
-- get_library_entry and list_library can be called by visitors who are not signed
-- in, and those visitors have no privileges on library_notes. Postgres checks table
-- privileges when a statement runs, and PL/pgSQL only runs the branch it takes, so
-- the statements that touch library_notes sit in branches that only the signed-in
-- owner reaches.
-- ---------------------------------------------------------------------------
create or replace function public.get_library_entry(p_title_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_entry jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select (to_jsonb(e) - 'user_id') || jsonb_build_object('notes', n.notes)
    into v_entry
    from public.library_entries e
    left join public.library_notes n on n.user_id = e.user_id and n.title_id = e.title_id
   where e.user_id = v_uid and e.title_id = p_title_id;

  return v_entry;
end;
$$;

-- Create or update the caller's entry. Null arguments mean "leave as is";
-- notes given as empty text (or only whitespace) are removed.
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
  v_notes     text;
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
    (user_id, title_id, status, progress, rating, is_private, started_at, completed_at)
  values (
    v_uid, p_title_id, v_status, v_progress, v_rating,
    coalesce(p_is_private, false),
    case when v_status <> 'planned' or v_progress > 0 then current_date end,
    case when v_status = 'completed' then current_date end
  )
  on conflict (user_id, title_id) do update set
    status       = excluded.status,
    progress     = excluded.progress,
    rating       = excluded.rating,
    is_private   = coalesce(p_is_private, e.is_private),
    started_at   = coalesce(e.started_at, excluded.started_at),
    completed_at = case when excluded.status = 'completed'
                        then coalesce(e.completed_at, current_date)
                        else e.completed_at end
  returning * into v_row;

  if p_notes is not null then
    v_notes := nullif(btrim(p_notes, E' \t\r\n'), '');
    if v_notes is null then
      delete from public.library_notes where user_id = v_uid and title_id = p_title_id;
    else
      insert into public.library_notes (user_id, title_id, notes)
      values (v_uid, p_title_id, v_notes)
      on conflict (user_id, title_id) do update set notes = excluded.notes;
    end if;
  end if;

  select n.notes into v_notes
    from public.library_notes n
   where n.user_id = v_uid and n.title_id = p_title_id;

  return (to_jsonb(v_row) - 'user_id') || jsonb_build_object('notes', v_notes);
end;
$$;

-- A user's library. With no user id it returns the caller's own. RLS decides which
-- entries a viewer may see; notes are only ever returned to the owner.
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

  -- (v_user = auth.uid()) is null for a visitor who is not signed in, which takes the else branch.
  if v_user = auth.uid() then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'entry', (to_jsonb(p) - 'user_id') || jsonb_build_object('notes', n.notes),
               'title', public.title_card(t),
               'progress_unit', public.progress_unit(t.media_type),
               'progress_total', public.title_progress_total(t))
             order by p.updated_at desc, p.title_id), '[]'::jsonb)
      into v_items
      from (
        select e.*
          from public.library_entries e
         where e.user_id = v_user and (p_status is null or e.status = p_status)
         order by e.updated_at desc, e.title_id
         limit v_limit offset v_offset
      ) p
      join public.titles t on t.id = p.title_id
      left join public.library_notes n on n.user_id = p.user_id and n.title_id = p.title_id;
  else
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'entry', to_jsonb(p) - 'user_id',
               'title', public.title_card(t),
               'progress_unit', public.progress_unit(t.media_type),
               'progress_total', public.title_progress_total(t))
             order by p.updated_at desc, p.title_id), '[]'::jsonb)
      into v_items
      from (
        select e.*
          from public.library_entries e
         where e.user_id = v_user and (p_status is null or e.status = p_status)
         order by e.updated_at desc, e.title_id
         limit v_limit offset v_offset
      ) p
      join public.titles t on t.id = p.title_id;
  end if;

  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end;
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
               || jsonb_build_object('notes', n.notes, 'title', t.title, 'media_type', t.media_type, 'title_slug', t.slug)
               order by e.updated_at desc, e.title_id)
      from public.library_entries e
      join public.titles t on t.id = e.title_id
      left join public.library_notes n on n.user_id = e.user_id and n.title_id = e.title_id
      where e.user_id = auth.uid()
    ), '[]'::jsonb)
  );
end;
$$;

-- create or replace keeps the privileges the earlier migration granted. Said again
-- here so that this file can be read on its own.
revoke all on function
  public.get_library_entry(uuid),
  public.upsert_library_entry(uuid, text, integer, integer, boolean, text, boolean),
  public.list_library(uuid, text, integer, integer),
  public.export_my_data()
from public, anon, authenticated;

grant execute on function
  public.get_library_entry(uuid),
  public.list_library(uuid, text, integer, integer)
to anon, authenticated;

grant execute on function
  public.upsert_library_entry(uuid, text, integer, integer, boolean, text, boolean),
  public.export_my_data()
to authenticated;

-- ---------------------------------------------------------------------------
-- 2. handle_new_user: a username taken between the sign-up form's check and this
--    insert no longer aborts the sign-up. The new member gets a generated name
--    and can change it in Settings.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wanted    text := new.raw_user_meta_data ->> 'username';
  v_generated text := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  v_username  text;
begin
  if v_wanted is not null
     and v_wanted ~ '^[A-Za-z0-9_]{3,24}$'
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(v_wanted)) then
    v_username := v_wanted;
  else
    v_username := v_generated;
  end if;

  begin
    insert into public.profiles (id, username) values (new.id, v_username);
  exception when unique_violation then
    if v_username = v_generated then
      raise;
    end if;
    insert into public.profiles (id, username) values (new.id, v_generated);
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. avatar_url is not written by anything yet.
-- ---------------------------------------------------------------------------
revoke update (avatar_url) on public.profiles from authenticated;
