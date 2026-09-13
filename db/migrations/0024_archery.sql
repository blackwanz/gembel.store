-- 0024_archery.sql
-- Backs archery.html ("Stargazer Archery — Log Latihan"), ported from a Claude-artifact
-- window.storage app to this site's own Supabase backend. The source app only ever reads/writes
-- five whole values by key ("arrows", "bows", "shots", "sessions", "lastMaterial") -- never a
-- single row within one of those arrays -- so one row per user with a jsonb column per key is the
-- right normalization level here, not underkill (it's a real per-user table with RLS, not a raw
-- blob) and not overkill (splitting shots/sessions/arrows/bows into their own foreign-keyed
-- tables would add joins and reconcile-on-save logic the app has no use for, since it always
-- reads and writes each array as a whole).

begin;

create table if not exists public.archery_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  arrows jsonb not null default '[]'::jsonb,
  bows jsonb not null default '[]'::jsonb,
  shots jsonb not null default '[]'::jsonb,
  sessions jsonb not null default '[]'::jsonb,
  last_material text null,
  updated_at timestamptz not null default now()
);

alter table public.archery_data enable row level security;

create policy archery_data_select on public.archery_data
  for select using (auth.uid() = user_id);
create policy archery_data_insert on public.archery_data
  for insert with check (auth.uid() = user_id);
create policy archery_data_update on public.archery_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy archery_data_delete on public.archery_data
  for delete using (auth.uid() = user_id);

-- Realtime (archery.html subscribes to postgres_changes for cross-device/tab sync) --
-- payment_requests already taught us the hard way (0022_payment_requests_realtime.sql) that a
-- table not being in this publication makes that subscription silently do nothing, so it's added
-- here from the start instead of being a bug to discover later.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'archery_data'
  ) then
    alter publication supabase_realtime add table public.archery_data;
  end if;
end $$;

insert into public._migrations (filename) values ('0024_archery.sql')
  on conflict (filename) do nothing;

commit;
