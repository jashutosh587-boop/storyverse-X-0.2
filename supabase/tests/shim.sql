-- TEST ONLY. Never run this against a real Supabase project.
--
-- Emulates the small part of Supabase that the migrations depend on: the three
-- API roles, the auth schema (users table and auth.uid()), the extensions
-- schema, and the default privileges Supabase gives new public objects.

create role anon          nologin;
create role authenticated nologin;
create role service_role  nologin bypassrls;

create schema if not exists auth;
create schema if not exists extensions;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Same lookup order as Supabase: the legacy per-claim setting, then the JSON claims.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
