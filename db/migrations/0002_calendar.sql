-- 0002_calendar.sql
-- Normalized tables backing the new calendar.html (goals + per-date
-- progress logging + theme). Replaces the old single-JSONB-blob
-- `user_calendar_data` table (left untouched -- see db/backfill_calendar.sql
-- for the one-time copy of existing rows into these new tables).

begin;

-- id is TEXT, not a generated uuid: calendar.html generates its own goal ids
-- client-side ('g_' + timestamp + random) and needs to write them verbatim
-- so the full-reconcile sync (upsert current set, delete the rest) can
-- match rows by the id the client already has in memory.
create table if not exists public.calendar_goals (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  hidden boolean not null default false,
  track_value boolean not null default false,
  format text not null default 'counter' check (format in ('counter', 'hours')),
  unit text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_goals_user_id_idx on public.calendar_goals(user_id);

alter table public.calendar_goals enable row level security;

create policy calendar_goals_select on public.calendar_goals
  for select using (auth.uid() = user_id);
create policy calendar_goals_insert on public.calendar_goals
  for insert with check (auth.uid() = user_id);
create policy calendar_goals_update on public.calendar_goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy calendar_goals_delete on public.calendar_goals
  for delete using (auth.uid() = user_id);

-- One row per *logged instance* of a goal on a date (a goal can be logged
-- more than once per day -- matches the source app's `entryId` concept).
-- id is TEXT for the same reason as calendar_goals.id above -- it's the
-- client-generated entryId ('e_' + timestamp + random).
create table if not exists public.calendar_goal_entries (
  id text primary key,
  goal_id text not null references public.calendar_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  value numeric null,
  created_at timestamptz not null default now()
);

create index if not exists calendar_goal_entries_user_date_idx
  on public.calendar_goal_entries(user_id, entry_date);
create index if not exists calendar_goal_entries_goal_id_idx
  on public.calendar_goal_entries(goal_id);

-- Server-side ownership enforcement: always derive user_id from the goal
-- being pointed at, regardless of what the client sends. This means a
-- client can never insert an entry against a goal_id it doesn't own, even
-- though RLS below only checks user_id -- the trigger is what keeps
-- user_id truthful in the first place.
create or replace function public.calendar_goal_entries_set_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select user_id into new.user_id from public.calendar_goals where id = new.goal_id;
  if new.user_id is null then
    raise exception 'calendar_goal_entries: goal_id % does not exist', new.goal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_goal_entries_set_owner_trg on public.calendar_goal_entries;
create trigger calendar_goal_entries_set_owner_trg
  before insert or update on public.calendar_goal_entries
  for each row execute function public.calendar_goal_entries_set_owner();

alter table public.calendar_goal_entries enable row level security;

create policy calendar_goal_entries_select on public.calendar_goal_entries
  for select using (auth.uid() = user_id);
create policy calendar_goal_entries_insert on public.calendar_goal_entries
  for insert with check (
    exists (select 1 from public.calendar_goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy calendar_goal_entries_update on public.calendar_goal_entries
  for update using (auth.uid() = user_id) with check (
    exists (select 1 from public.calendar_goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy calendar_goal_entries_delete on public.calendar_goal_entries
  for delete using (auth.uid() = user_id);

create table if not exists public.calendar_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light'
);

alter table public.calendar_settings enable row level security;

create policy calendar_settings_select on public.calendar_settings
  for select using (auth.uid() = user_id);
create policy calendar_settings_insert on public.calendar_settings
  for insert with check (auth.uid() = user_id);
create policy calendar_settings_update on public.calendar_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy calendar_settings_delete on public.calendar_settings
  for delete using (auth.uid() = user_id);

insert into public._migrations (filename) values ('0002_calendar.sql')
  on conflict (filename) do nothing;

commit;
