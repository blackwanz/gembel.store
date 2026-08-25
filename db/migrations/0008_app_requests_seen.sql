-- 0008_app_requests_seen.sql
-- Lets admin.html show a badge/count of app_requests an admin hasn't
-- looked at yet, instead of admins having to scan the whole list to spot
-- new ones.

begin;

alter table public.app_requests add column if not exists seen_by_admin boolean not null default false;

insert into public._migrations (filename) values ('0008_app_requests_seen.sql')
  on conflict (filename) do nothing;

commit;
