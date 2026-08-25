-- 0007_leaderboard.sql
-- Monthly leaderboard: points per user per month, based on Rupiah spent.
-- Points are set manually by an admin for now (no automatic calculation
-- from real transaction data yet) -- everyone logged in can read the
-- leaderboard, only an admin (profiles.role = 'admin') can write to it.

begin;

create table if not exists public.leaderboard_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  points numeric not null default 0,
  updated_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (user_id, period_month)
);

create index if not exists leaderboard_points_period_idx on public.leaderboard_points(period_month, points desc);

alter table public.leaderboard_points enable row level security;

create policy leaderboard_points_select on public.leaderboard_points
  for select to authenticated
  using (true);

-- Only an admin (checked via profiles.role, same convention as every other
-- admin-gated action in this app -- there's no JWT role claim for this)
-- may insert/update/delete leaderboard rows.
create policy leaderboard_points_insert on public.leaderboard_points
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy leaderboard_points_update on public.leaderboard_points
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy leaderboard_points_delete on public.leaderboard_points
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public._migrations (filename) values ('0007_leaderboard.sql')
  on conflict (filename) do nothing;

commit;
