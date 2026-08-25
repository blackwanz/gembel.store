-- 0006_schema_grants.sql
-- Root-cause fix for "permission denied for table X" / "new row violates
-- row-level security policy" errors showing up across BOTH pre-existing
-- tables (app_requests, profiles, payment_requests, user_calendar_data,
-- user_progbar_data) and the newer ones from 0002-0005. A normal Supabase
-- project auto-configures these grants on the public schema when it's
-- provisioned; this restored project apparently didn't inherit that.
-- Re-establishing it here (this is exactly what Supabase sets up by
-- default) fixes every current table in one shot AND makes it automatic
-- for every table created from now on.
--
-- This does NOT bypass RLS -- granting the base table privilege is a
-- separate, lower layer than RLS. Each role can still only see/touch
-- whatever its existing RLS policies already allow; this just lets
-- Postgres get far enough to evaluate those policies at all.

begin;

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;

insert into public._migrations (filename) values ('0006_schema_grants.sql')
  on conflict (filename) do nothing;

commit;
