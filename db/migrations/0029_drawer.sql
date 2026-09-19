-- 0029_drawer.sql
-- Backs drawer.html ("Recall Drawer"), ported from a self-contained localStorage-only prototype
-- to this site's own Supabase backend. The prototype only ever reads/writes state.entries as one
-- whole array (see loadLocal()/saveLocal() in the original) -- never a single entry row on its
-- own -- so one row per user with a single jsonb column is the right normalization level here,
-- same reasoning as 0024_archery.sql's archery_data table.

begin;

create table if not exists public.drawer_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.drawer_data enable row level security;

create policy drawer_data_select on public.drawer_data
  for select using (auth.uid() = user_id);
create policy drawer_data_insert on public.drawer_data
  for insert with check (auth.uid() = user_id);
create policy drawer_data_update on public.drawer_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy drawer_data_delete on public.drawer_data
  for delete using (auth.uid() = user_id);

-- Realtime (drawer.html subscribes to postgres_changes for cross-device/tab sync) -- added from
-- the start rather than as a follow-up fix; see 0022_payment_requests_realtime.sql for what
-- happens when a table is left out of this publication (the subscription just silently never
-- fires, no error).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drawer_data'
  ) then
    alter publication supabase_realtime add table public.drawer_data;
  end if;
end $$;

insert into public._migrations (filename) values ('0029_drawer.sql')
  on conflict (filename) do nothing;

commit;
