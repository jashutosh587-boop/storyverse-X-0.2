-- STORYVERSE X · migration 6 · site-level functions
--
-- Home page counts, the data-source credits page, and account deletion.

-- ---------------------------------------------------------------------------
-- catalog_stats: how many real titles there are, per medium. Stubs are
-- placeholders for works not ingested yet, so they are not counted.
-- ---------------------------------------------------------------------------
create or replace function public.catalog_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total',   coalesce(sum(c.n), 0),
    'by_type', coalesce(jsonb_object_agg(c.media_type, c.n), '{}'::jsonb)
  )
  from (
    select t.media_type, count(*) as n
    from public.titles t
    where not t.is_stub
    group by t.media_type
  ) c;
$$;

-- ---------------------------------------------------------------------------
-- catalog_attributions: which providers the catalog's data came from, how many
-- titles each supplied, and the credit text each one requires. Only providers
-- that actually supplied a visible title are listed.
-- ---------------------------------------------------------------------------
create or replace function public.catalog_attributions()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'provider',        a.provider,
             'titles',          a.titles,
             'attribution',     a.attribution,
             'last_fetched_at', a.last_fetched_at)
           order by a.provider), '[]'::jsonb)
  from (
    select s.provider,
           count(distinct s.title_id) as titles,
           max(s.attribution)         as attribution,
           max(s.fetched_at)          as last_fetched_at
    from public.title_sources s
    join public.titles t on t.id = s.title_id and not t.is_stub
    group by s.provider
  ) a;
$$;

-- ---------------------------------------------------------------------------
-- delete_my_account: permanently removes the caller's account and everything
-- attached to it (profile, library, ratings, notes). SECURITY DEFINER because
-- ordinary users cannot touch auth.users; the function only ever acts on
-- auth.uid(), and takes no argument that could name another user.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- profiles and library_entries cascade from auth.users.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function
  public.catalog_stats(),
  public.catalog_attributions(),
  public.delete_my_account()
from public, anon, authenticated;

grant execute on function public.catalog_stats(), public.catalog_attributions() to anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
