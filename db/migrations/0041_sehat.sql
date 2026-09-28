-- 0041_sehat.sql
-- "Sehat" (sehat.html): a health tracker that owns almost no data of its own -- it reads what's
-- already logged elsewhere and turns it into health stats:
--   makan     -> habbit_entries expenses whose finance_tag is one of food_tags (activity = what was eaten)
--   olahraga  -> habbit_entries timed activities whose name is one of sport_activities (total_second)
--   tidur     -> Kalender 'time' goals Bangun/Tidur (0039), or a timed habbit activity (e.g. "Tidur")
--   BMI       -> profiles.height_cm / profiles.weight_kg (new here; required before the app opens)
--
-- health_settings holds the one-time "ambil data dari mana" answer. It's asked once (setup_done_at
-- null -> setup screen), changeable later from the app's Sumber Data tab.
--
-- health_weight_logs keeps a weight history for the trend chart. It's fed by a trigger on
-- profiles.weight_kg, so editing weight in the dashboard profile OR in Sehat both land here
-- without either page having to remember to write the log.

begin;

alter table public.profiles add column if not exists height_cm numeric
  check (height_cm is null or (height_cm between 50 and 260));
alter table public.profiles add column if not exists weight_kg numeric
  check (weight_kg is null or (weight_kg between 20 and 400));

create table if not exists public.health_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'simple' check (mode in ('simple', 'complex')),
  food_tags text[] not null default '{}',
  sport_activities text[] not null default '{}',
  sleep_source text not null default 'calendar' check (sleep_source in ('calendar', 'habbit')),
  sleep_goal_id text null,        -- calendar_goals.id of the "Tidur" time goal
  wake_goal_id text null,         -- calendar_goals.id of the "Bangun" time goal
  sleep_activity text null,       -- habbit activity name when sleep_source = 'habbit'
  sleep_target_min integer not null default 480 check (sleep_target_min between 180 and 720),
  sport_target_min integer not null default 150 check (sport_target_min between 0 and 3000),
  setup_done_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.health_settings enable row level security;

create policy health_settings_select on public.health_settings
  for select using (auth.uid() = user_id);
create policy health_settings_insert on public.health_settings
  for insert with check (auth.uid() = user_id);
create policy health_settings_update on public.health_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy health_settings_delete on public.health_settings
  for delete using (auth.uid() = user_id);

create table if not exists public.health_weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  weight_kg numeric not null check (weight_kg between 20 and 400),
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

create index if not exists health_weight_logs_user_date_idx on public.health_weight_logs(user_id, log_date);

alter table public.health_weight_logs enable row level security;

create policy health_weight_logs_select on public.health_weight_logs
  for select using (auth.uid() = user_id);
create policy health_weight_logs_insert on public.health_weight_logs
  for insert with check (auth.uid() = user_id);
create policy health_weight_logs_update on public.health_weight_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy health_weight_logs_delete on public.health_weight_logs
  for delete using (auth.uid() = user_id);

-- One row per day (Jakarta date): re-saving the same day overwrites that day's weight.
create or replace function public.profiles_log_weight()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.weight_kg is not null and new.weight_kg is distinct from old.weight_kg then
    insert into public.health_weight_logs (user_id, log_date, weight_kg)
    values (new.id, (now() at time zone 'Asia/Jakarta')::date, new.weight_kg)
    on conflict (user_id, log_date) do update set weight_kg = excluded.weight_kg;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_log_weight_trg on public.profiles;
create trigger profiles_log_weight_trg
  after update of weight_kg on public.profiles
  for each row execute function public.profiles_log_weight();

grant all on public.health_settings, public.health_weight_logs to authenticated, service_role;

insert into public._migrations (filename) values ('0041_sehat.sql')
  on conflict (filename) do nothing;

commit;
