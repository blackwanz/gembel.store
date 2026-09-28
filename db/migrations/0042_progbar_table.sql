-- 0042_progbar_table.sql
-- progbar.html (Neon Flow) syncs to public.user_progbar_data, which 0001_init.sql assumed was a
-- "pre-existing, out of scope" table. It turned out not to exist in the live project at all, so
-- every saveCloud()/loadCloud() call failed silently (both are wrapped in try/catch) and Neon
-- Flow was effectively local-only. This creates it in the exact shape progbar.html writes:
-- one row per user, upserted on user_id, with the history array + running session as JSON.
-- Also does what 0026_progbar_realtime.sql meant to do (add it to supabase_realtime), since
-- 0026 skips itself when the table is missing.

begin;

create table if not exists public.user_progbar_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  history jsonb not null default '[]'::jsonb,
  current_state jsonb null,
  updated_at timestamptz not null default now()
);

alter table public.user_progbar_data enable row level security;

drop policy if exists user_progbar_data_select on public.user_progbar_data;
create policy user_progbar_data_select on public.user_progbar_data
  for select using (auth.uid() = user_id);
drop policy if exists user_progbar_data_insert on public.user_progbar_data;
create policy user_progbar_data_insert on public.user_progbar_data
  for insert with check (auth.uid() = user_id);
drop policy if exists user_progbar_data_update on public.user_progbar_data;
create policy user_progbar_data_update on public.user_progbar_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists user_progbar_data_delete on public.user_progbar_data;
create policy user_progbar_data_delete on public.user_progbar_data
  for delete using (auth.uid() = user_id);

grant all on public.user_progbar_data to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_progbar_data'
  ) then
    alter publication supabase_realtime add table public.user_progbar_data;
  end if;
end $$;

insert into public._migrations (filename) values ('0042_progbar_table.sql')
  on conflict (filename) do nothing;

commit;
