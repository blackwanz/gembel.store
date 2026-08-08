-- 0003_habbit.sql
-- Normalized tables backing the new habbit.html ("Aktivitas & Pengeluaran"):
-- timed activities + income/expense entries, budget/salary settings,
-- per-category targets, savings targets, and the budget planner.

begin;

-- Unifies the source app's separate running[]/history[] arrays via `status`.
-- Kept as plain date/time columns (not timestamptz) on purpose: the source
-- app has no timezone concept at all, it's plain local browser time, and
-- introducing timestamptz would require inventing a timezone-conversion
-- rule that doesn't exist today. end_date is the one thing date-only can't
-- represent (an activity spanning midnight) -- nullable, client sets it
-- equal to start_date unless it actually spans midnight.
-- id is TEXT, not a generated uuid: habbit.html generates its own ids
-- client-side (newId(): crypto.randomUUID() when available, else a
-- timestamp+random fallback string that isn't guaranteed UUID-shaped) and
-- needs to write them verbatim so the full-reconcile sync (upsert current
-- set, delete the rest) can match rows by the id the client already has.
create table if not exists public.habbit_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity text not null,
  finance_flag boolean not null default false,
  finance_type text null check (finance_type in ('income', 'expense')),
  finance_tag text null,
  nominal numeric null,
  qty numeric null,
  qty_unit text null,
  start_date date not null,
  time_start time not null,
  end_date date null,
  time_end time null,
  total_second integer null,
  status text not null default 'running' check (status in ('running', 'finished')),
  created_at timestamptz not null default now()
);

create index if not exists habbit_entries_user_start_date_idx on public.habbit_entries(user_id, start_date);
create index if not exists habbit_entries_user_status_idx on public.habbit_entries(user_id, status);

alter table public.habbit_entries enable row level security;

create policy habbit_entries_select on public.habbit_entries
  for select using (auth.uid() = user_id);
create policy habbit_entries_insert on public.habbit_entries
  for insert with check (auth.uid() = user_id);
create policy habbit_entries_update on public.habbit_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habbit_entries_delete on public.habbit_entries
  for delete using (auth.uid() = user_id);

create table if not exists public.habbit_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget numeric null,
  salary numeric null,
  month_cutoff_day integer not null default 1
);

alter table public.habbit_settings enable row level security;

create policy habbit_settings_select on public.habbit_settings
  for select using (auth.uid() = user_id);
create policy habbit_settings_insert on public.habbit_settings
  for insert with check (auth.uid() = user_id);
create policy habbit_settings_update on public.habbit_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habbit_settings_delete on public.habbit_settings
  for delete using (auth.uid() = user_id);

create table if not exists public.habbit_category_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  mode text not null default 'amount' check (mode in ('amount', 'percent')),
  amount numeric null,
  percent numeric null,
  unique (user_id, category),
  check (
    (mode = 'amount' and amount is not null)
    or (mode = 'percent' and percent is not null)
  )
);

create index if not exists habbit_category_targets_user_id_idx on public.habbit_category_targets(user_id);

alter table public.habbit_category_targets enable row level security;

create policy habbit_category_targets_select on public.habbit_category_targets
  for select using (auth.uid() = user_id);
create policy habbit_category_targets_insert on public.habbit_category_targets
  for insert with check (auth.uid() = user_id);
create policy habbit_category_targets_update on public.habbit_category_targets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habbit_category_targets_delete on public.habbit_category_targets
  for delete using (auth.uid() = user_id);

-- target_month stored as a real first-of-month date, not free text --
-- avoids reintroducing the stringly-typed-date problem this rewrite is
-- otherwise fixing.
create table if not exists public.habbit_savings_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_month date not null,
  target_amount numeric null,
  target_rate numeric null,
  unique (user_id, target_month),
  check (target_amount is not null or target_rate is not null)
);

create index if not exists habbit_savings_targets_user_id_idx on public.habbit_savings_targets(user_id);

alter table public.habbit_savings_targets enable row level security;

create policy habbit_savings_targets_select on public.habbit_savings_targets
  for select using (auth.uid() = user_id);
create policy habbit_savings_targets_insert on public.habbit_savings_targets
  for insert with check (auth.uid() = user_id);
create policy habbit_savings_targets_update on public.habbit_savings_targets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habbit_savings_targets_delete on public.habbit_savings_targets
  for delete using (auth.uid() = user_id);

-- id is TEXT for the same reason as habbit_entries.id above.
create table if not exists public.habbit_planner_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  name text not null,
  amount numeric not null,
  recurring boolean not null default false,
  due_day integer null,
  lead_days integer null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists habbit_planner_items_user_period_idx on public.habbit_planner_items(user_id, period_month);

alter table public.habbit_planner_items enable row level security;

create policy habbit_planner_items_select on public.habbit_planner_items
  for select using (auth.uid() = user_id);
create policy habbit_planner_items_insert on public.habbit_planner_items
  for insert with check (auth.uid() = user_id);
create policy habbit_planner_items_update on public.habbit_planner_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habbit_planner_items_delete on public.habbit_planner_items
  for delete using (auth.uid() = user_id);

insert into public._migrations (filename) values ('0003_habbit.sql')
  on conflict (filename) do nothing;

commit;
