-- 0005_grants.sql
-- Fixes "permission denied for table X" (Postgres error 42501) on every
-- table introduced by 0002/0003/0004. RLS policies alone aren't enough --
-- Postgres also requires a base table-level GRANT to the role before RLS
-- policies are even evaluated. Supabase projects normally get this for
-- free via a default-privileges rule on the public schema, but this
-- restored project apparently didn't inherit it, so granting explicitly
-- here instead of relying on that.
--
-- Only the `authenticated` role gets grants -- every RLS policy on these
-- tables is scoped `to authenticated`, so `anon` has nothing to do here
-- and stays fully locked out, matching "logged-in users only."

begin;

grant select, insert, update, delete on public.calendar_goals to authenticated;
grant select, insert, update, delete on public.calendar_goal_entries to authenticated;
grant select, insert, update, delete on public.calendar_settings to authenticated;

grant select, insert, update, delete on public.habbit_entries to authenticated;
grant select, insert, update, delete on public.habbit_settings to authenticated;
grant select, insert, update, delete on public.habbit_category_targets to authenticated;
grant select, insert, update, delete on public.habbit_savings_targets to authenticated;
grant select, insert, update, delete on public.habbit_planner_items to authenticated;

grant select, insert, delete on public.save_files to authenticated;

insert into public._migrations (filename) values ('0005_grants.sql')
  on conflict (filename) do nothing;

commit;
