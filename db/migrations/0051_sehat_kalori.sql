-- 0051_sehat_kalori.sql
-- Kalori tab in Sehat (sehat.html): a rough day-to-day calorie intake.
--
-- Meals still come from habbit_entries expenses tagged as food (0041) -- the page estimates each
-- one's kcal from its name (built-in dictionary) and assumes 1 plate of rice where the dish
-- usually comes with rice. Nothing is stored until the user corrects something:
--
--   health_calorie_logs  one row per corrected expense (entry_id set) or per manually added food
--                        (entry_id null, e.g. home cooking that never became an expense).
--                        kcal = the dish WITHOUT plain rice; rice = plates of white rice on top.
--                        skipped = "this expense isn't food I ate" (bought for someone else, etc).
--   health_food_kcal     what the user taught us per menu name, so the next "Nasi Padang" expense
--                        is estimated with their numbers instead of the dictionary's.
--
-- health_settings gains the inputs for the daily target: sex (falls back to profile_ktp.gender on
-- the page) and calorie_target (null = auto from BMR x activity, adjusted by BMI).

begin;

alter table public.health_settings add column if not exists sex text null check (sex is null or sex in ('L', 'P'));
alter table public.health_settings add column if not exists calorie_target integer null
  check (calorie_target is null or (calorie_target between 800 and 6000));

create table if not exists public.health_calorie_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  time_at time null,
  entry_id text null,             -- habbit_entries.id this row corrects; null = manual food
  name text not null check (length(btrim(name)) between 1 and 120),
  kcal integer not null default 0 check (kcal between 0 and 10000),
  rice numeric not null default 0 check (rice between 0 and 5),
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_id)
);

create index if not exists health_calorie_logs_user_date_idx on public.health_calorie_logs(user_id, log_date);

alter table public.health_calorie_logs enable row level security;

drop policy if exists health_calorie_logs_select on public.health_calorie_logs;
create policy health_calorie_logs_select on public.health_calorie_logs
  for select using (auth.uid() = user_id);
drop policy if exists health_calorie_logs_insert on public.health_calorie_logs;
create policy health_calorie_logs_insert on public.health_calorie_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists health_calorie_logs_update on public.health_calorie_logs;
create policy health_calorie_logs_update on public.health_calorie_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists health_calorie_logs_delete on public.health_calorie_logs;
create policy health_calorie_logs_delete on public.health_calorie_logs
  for delete using (auth.uid() = user_id);

create table if not exists public.health_food_kcal (
  user_id uuid not null references auth.users(id) on delete cascade,
  name_key text not null,         -- lower(trim(name))
  kcal integer not null check (kcal between 0 and 10000),
  rice numeric not null default 0 check (rice between 0 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, name_key)
);

alter table public.health_food_kcal enable row level security;

drop policy if exists health_food_kcal_select on public.health_food_kcal;
create policy health_food_kcal_select on public.health_food_kcal
  for select using (auth.uid() = user_id);
drop policy if exists health_food_kcal_insert on public.health_food_kcal;
create policy health_food_kcal_insert on public.health_food_kcal
  for insert with check (auth.uid() = user_id);
drop policy if exists health_food_kcal_update on public.health_food_kcal;
create policy health_food_kcal_update on public.health_food_kcal
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists health_food_kcal_delete on public.health_food_kcal;
create policy health_food_kcal_delete on public.health_food_kcal
  for delete using (auth.uid() = user_id);

grant all on public.health_calorie_logs, public.health_food_kcal to authenticated, service_role;

insert into public._migrations (filename) values ('0051_sehat_kalori.sql')
  on conflict (filename) do nothing;

commit;
