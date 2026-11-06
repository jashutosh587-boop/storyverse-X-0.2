-- STORYVERSE X · migration 3 · profiles and the personal library
--
-- Privacy model
--   * A profile is public by default and can be made private.
--   * A library entry is visible to others only if the owner's profile is public
--     AND the entry itself is not marked private.
--   * Only the owner can create, change or delete their own rows.

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name  text check (char_length(display_name) <= 60),
  bio           text check (char_length(bio) <= 500),
  avatar_url    text,
  is_public     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "public profiles and your own are readable"
  on public.profiles for select to anon, authenticated
  using (is_public or id = (select auth.uid()));

create policy "you can edit your own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Profiles are created by the trigger below, never by clients.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username, display_name, bio, avatar_url, is_public) on public.profiles to authenticated;

-- Create a profile for every new auth user. The username comes from the signup
-- form when it is valid and free, otherwise a neutral generated one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wanted   text := new.raw_user_meta_data ->> 'username';
  v_username text;
begin
  if v_wanted is not null
     and v_wanted ~ '^[A-Za-z0-9_]{3,24}$'
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(v_wanted)) then
    v_username := v_wanted;
  else
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- library_entries: what a user watches/reads, how far, and what they thought
-- ---------------------------------------------------------------------------
create table public.library_entries (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  title_id      uuid not null references public.titles (id) on delete cascade,
  status        text not null
                check (status in ('planned','in_progress','completed','paused','dropped','repeating')),
  progress      integer not null default 0 check (progress >= 0),
  rating        smallint check (rating between 1 and 10),
  notes         text check (char_length(notes) <= 2000),
  is_private    boolean not null default false,
  started_at    date,
  completed_at  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, title_id)
);
create index library_entries_user_status on public.library_entries (user_id, status, updated_at desc);
create index library_entries_title_rating on public.library_entries (title_id) where rating is not null;

create trigger library_entries_set_updated_at
  before update on public.library_entries
  for each row execute function public.set_updated_at();

alter table public.library_entries enable row level security;

create policy "owner, or anyone for public non-private entries"
  on public.library_entries for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (
      not is_private
      and exists (
        select 1 from public.profiles p
        where p.id = library_entries.user_id and p.is_public
      )
    )
  );

create policy "owner can add entries"
  on public.library_entries for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner can change entries"
  on public.library_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner can delete entries"
  on public.library_entries for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.library_entries from anon, authenticated;
grant select on public.library_entries to anon, authenticated;
grant insert, update, delete on public.library_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Community rating summary for a title. Aggregates only: individual ratings
-- of private entries are never exposed, but they do count towards the total.
--
-- 'bayesian' pulls small samples toward a prior of 7.0 with a weight of 10
-- ratings, which blunts rating spam on titles with few votes.
-- ---------------------------------------------------------------------------
create or replace function public.title_rating_summary(p_title_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select rating
    from public.library_entries
    where title_id = p_title_id and rating is not null
  )
  select jsonb_build_object(
    'count',        (select count(*) from r),
    'average',      (select round(avg(rating)::numeric, 2) from r),
    'bayesian',     (select round(((10 * 7.0 + coalesce(sum(rating), 0)) / (10 + count(*)))::numeric, 2) from r),
    'distribution', coalesce(
                      (select jsonb_object_agg(d.rating::text, d.n)
                         from (select rating, count(*) as n from r group by rating) d),
                      '{}'::jsonb)
  );
$$;

revoke all on function public.title_rating_summary(uuid) from public, anon, authenticated;
grant execute on function public.title_rating_summary(uuid) to anon, authenticated;
