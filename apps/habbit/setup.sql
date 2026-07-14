-- ============================================================
-- HABBIT — full database schema (Supabase / Postgres)
-- ============================================================
-- Run this once in the Supabase SQL Editor for a fresh project.
-- If you already have habbit_h / habbit_d from before, skip to
-- the "MIGRATION — existing databases" section near the bottom
-- instead of re-running the CREATE TABLE statements.
-- ============================================================


-- ---------------------------------------------------------------
-- TABLE: profiles
-- One row per user, keyed to auth.users. Only holds display info.
-- ---------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: user reads own row"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles: user updates own row"
  on profiles for update
  using (auth.uid() = id);


-- ---------------------------------------------------------------
-- TABLE: habbit_h  ("h" = habbit HAPPENING / running now)
-- One row per activity the user has started but not yet stopped.
-- Deleted the moment it's stopped (moved into habbit_d instead).
-- ---------------------------------------------------------------
create table if not exists habbit_h (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  activity_id   uuid not null,                 -- carried over to habbit_d on stop, links the two rows
  activity      text not null check (char_length(activity) >= 3 and char_length(activity) <= 200),
  time_start    time not null,                 -- browser-local time the activity was started
  start_date    date not null,                 -- browser-local calendar date it was started
  created_at    timestamptz not null default now()
);

create index if not exists idx_habbit_h_user on habbit_h (user_id, created_at desc);

alter table habbit_h enable row level security;

create policy "habbit_h: user selects own rows"
  on habbit_h for select
  using (auth.uid() = user_id);

create policy "habbit_h: user inserts own rows"
  on habbit_h for insert
  with check (auth.uid() = user_id);

create policy "habbit_h: user deletes own rows"
  on habbit_h for delete
  using (auth.uid() = user_id);
-- No update policy — rows are only ever inserted then deleted
-- (via stop_habbit), never edited in place.


-- ---------------------------------------------------------------
-- TABLE: habbit_d  ("d" = habbit DONE / history)
-- Append-only. Two kinds of row, distinguished by finance_flag:
--   finance_flag = false  -> a timed activity that was stopped
--   finance_flag = true   -> an expense, recorded directly (no
--                            "running" phase, never touches habbit_h)
-- ---------------------------------------------------------------
create table if not exists habbit_d (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  activity_id     uuid not null,
  activity        text not null check (char_length(activity) >= 3 and char_length(activity) <= 200),

  -- timing (always filled; for expenses time_start = time_end, duration = 0)
  time_start      time not null,
  time_end        time not null,
  total_hours     numeric not null default 0,
  total_second    integer not null default 0 check (total_second >= 0),

  -- NEW: optional quantity logged when stopping a timed activity,
  -- e.g. qty = 10, qty_unit = 'Repetisi'. Always null for expenses.
  qty             numeric check (qty is null or qty > 0),
  qty_unit        text check (qty_unit is null or char_length(qty_unit) <= 40),

  -- finance branch (only meaningful when finance_flag = true)
  finance_flag    boolean not null default false,
  finance_tag     text check (finance_tag is null or char_length(finance_tag) <= 60),
  nominal         numeric check (nominal is null or nominal > 0),

  -- dates
  effective_date  date not null,   -- the date this entry "counts" toward (usually = start_date)
  start_date      date not null,
  end_date        date not null,

  created_at      timestamptz not null default now(),

  -- an expense must have a nominal; a non-expense must not
  constraint chk_finance_shape check (
    (finance_flag = true  and nominal is not null) or
    (finance_flag = false and nominal is null)
  )
);

create index if not exists idx_habbit_d_user on habbit_d (user_id, created_at desc);
create index if not exists idx_habbit_d_user_start on habbit_d (user_id, start_date);

alter table habbit_d enable row level security;

create policy "habbit_d: user selects own rows"
  on habbit_d for select
  using (auth.uid() = user_id);

create policy "habbit_d: user inserts own rows"
  on habbit_d for insert
  with check (auth.uid() = user_id);
-- No update/delete policy — history is append-only by design,
-- even for the row's own owner.


-- ---------------------------------------------------------------
-- RPC: stop_habbit
-- Atomically moves one habbit_h row into habbit_d (one row
-- inserted + one row deleted, in a single transaction) so there
-- is never a window where a client-side insert-then-delete could
-- half-fail and leave a duplicate or an orphaned running row.
--
-- p_qty / p_qty_unit are optional (NULL = user skipped them).
-- ---------------------------------------------------------------
create or replace function stop_habbit(
  p_habbit_h_id uuid,
  p_time_end    time,
  p_end_date    date,
  p_qty         numeric default null,
  p_qty_unit    text    default null
)
returns habbit_d
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      habbit_h;
  v_result   habbit_d;
  v_seconds  integer;
begin
  select * into v_row
  from habbit_h
  where id = p_habbit_h_id
    and user_id = auth.uid()      -- can only stop your own running activity
  for update;

  if not found then
    raise exception 'Activity not found or not yours.';
  end if;

  v_seconds := greatest(
    0,
    extract(epoch from (
      (p_end_date::timestamp + p_time_end) -
      (v_row.start_date::timestamp + v_row.time_start)
    ))::integer
  );

  insert into habbit_d (
    user_id, activity_id, activity,
    time_start, time_end, total_hours, total_second,
    qty, qty_unit,
    finance_flag, finance_tag, nominal,
    effective_date, start_date, end_date
  ) values (
    v_row.user_id, v_row.activity_id, v_row.activity,
    v_row.time_start, p_time_end, round(v_seconds / 3600.0, 2), v_seconds,
    p_qty, p_qty_unit,
    false, null, null,
    v_row.start_date, v_row.start_date, p_end_date
  )
  returning * into v_result;

  delete from habbit_h where id = p_habbit_h_id;

  return v_result;
end;
$$;


-- ---------------------------------------------------------------
-- REALTIME
-- Adds both tables to the publication the app subscribes to.
-- ---------------------------------------------------------------
alter publication supabase_realtime add table habbit_h;
alter publication supabase_realtime add table habbit_d;


-- ============================================================
-- MIGRATION — existing databases (already have habbit_h/habbit_d
-- from before this update). Run ONLY this section.
-- ============================================================
alter table habbit_d add column if not exists qty numeric
  check (qty is null or qty > 0);
alter table habbit_d add column if not exists qty_unit text
  check (qty_unit is null or char_length(qty_unit) <= 40);

-- Replace stop_habbit with the new signature (adds p_qty/p_qty_unit,
-- both optional so existing callers with the old 3-arg signature
-- still work — Postgres resolves by matching provided args to
-- defaults).
create or replace function stop_habbit(
  p_habbit_h_id uuid,
  p_time_end    time,
  p_end_date    date,
  p_qty         numeric default null,
  p_qty_unit    text    default null
)
returns habbit_d
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      habbit_h;
  v_result   habbit_d;
  v_seconds  integer;
begin
  select * into v_row
  from habbit_h
  where id = p_habbit_h_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Activity not found or not yours.';
  end if;

  v_seconds := greatest(
    0,
    extract(epoch from (
      (p_end_date::timestamp + p_time_end) -
      (v_row.start_date::timestamp + v_row.time_start)
    ))::integer
  );

  insert into habbit_d (
    user_id, activity_id, activity,
    time_start, time_end, total_hours, total_second,
    qty, qty_unit,
    finance_flag, finance_tag, nominal,
    effective_date, start_date, end_date
  ) values (
    v_row.user_id, v_row.activity_id, v_row.activity,
    v_row.time_start, p_time_end, round(v_seconds / 3600.0, 2), v_seconds,
    p_qty, p_qty_unit,
    false, null, null,
    v_row.start_date, v_row.start_date, p_end_date
  )
  returning * into v_result;

  delete from habbit_h where id = p_habbit_h_id;

  return v_result;
end;
$$;
