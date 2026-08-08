-- 0001_init.sql
-- Baseline marker. Creates the migration-tracking table itself.
-- Deliberately does NOT touch any existing table (profiles, app_requests,
-- payment_requests, user_calendar_data, user_progbar_data) -- those already
-- exist in the live project and are out of scope here.

begin;

create table if not exists public._migrations (
  id serial primary key,
  filename text not null unique,
  applied_at timestamptz not null default now()
);

-- Deny-all via PostgREST: enabling RLS with zero policies blocks both the
-- anon and authenticated roles entirely. Only a direct DB connection (i.e.
-- db/migrate.sh itself, using the service/owner role) can read or write
-- this table -- it has no business being reachable from the browser.
alter table public._migrations enable row level security;

insert into public._migrations (filename) values ('0001_init.sql')
  on conflict (filename) do nothing;

commit;
