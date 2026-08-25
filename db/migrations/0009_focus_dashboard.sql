-- 0009_focus_dashboard.sql
-- Backs the new Focus Dashboard app: kanban tasks, a daily timeline
-- (schedule + actual-execution history), long-term goals with weighted
-- task links, and timed focus sessions.
--
-- All id columns are TEXT, not generated uuids: the source app generates
-- its own ids client-side (uid(prefix): prefix + timestamp + random) and
-- needs to write them verbatim so the full-reconcile sync (upsert current
-- set, delete the rest -- same pattern as calendar.html/habbit.html) can
-- match rows by the id the client already has.

begin;

create table if not exists public.focus_tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text null,
  category text not null,
  priority text not null check (priority in ('High', 'Medium', 'Low')),
  status text not null check (status in ('todo', 'progress', 'done')),
  est_minutes numeric null,
  sort_order integer not null default 0,
  due_date date null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists focus_tasks_user_id_idx on public.focus_tasks(user_id);

alter table public.focus_tasks enable row level security;
create policy focus_tasks_select on public.focus_tasks for select to authenticated using (auth.uid() = user_id);
create policy focus_tasks_insert on public.focus_tasks for insert to authenticated with check (auth.uid() = user_id);
create policy focus_tasks_update on public.focus_tasks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy focus_tasks_delete on public.focus_tasks for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.focus_timeline_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  entry_time time not null,
  duration_min integer not null default 30,
  title text not null,
  category text not null,
  description text null,
  done boolean not null default false,
  hidden_from_spiral boolean not null default false
);

create index if not exists focus_timeline_entries_user_date_idx on public.focus_timeline_entries(user_id, entry_date);

alter table public.focus_timeline_entries enable row level security;
create policy focus_timeline_entries_select on public.focus_timeline_entries for select to authenticated using (auth.uid() = user_id);
create policy focus_timeline_entries_insert on public.focus_timeline_entries for insert to authenticated with check (auth.uid() = user_id);
create policy focus_timeline_entries_update on public.focus_timeline_entries for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy focus_timeline_entries_delete on public.focus_timeline_entries for delete to authenticated using (auth.uid() = user_id);

-- target_month stored as a real first-of-month date (source app keeps it
-- as a "YYYY-MM" string), same reasoning as habbit's target_month/
-- period_month columns -- avoids a stringly-typed date.
create table if not exists public.focus_goals (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  target_month date null,
  progress integer not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now()
);

create index if not exists focus_goals_user_id_idx on public.focus_goals(user_id);

alter table public.focus_goals enable row level security;
create policy focus_goals_select on public.focus_goals for select to authenticated using (auth.uid() = user_id);
create policy focus_goals_insert on public.focus_goals for insert to authenticated with check (auth.uid() = user_id);
create policy focus_goals_update on public.focus_goals for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy focus_goals_delete on public.focus_goals for delete to authenticated using (auth.uid() = user_id);

-- A goal's progress bar can be driven by a weighted sum of its linked
-- tasks (weight = % of the goal that task's completion is worth) instead
-- of a manually-set number. user_id is server-derived from goal_id via
-- trigger (same pattern as calendar_goal_entries) so a client can never
-- spoof a link onto a goal it doesn't own.
create table if not exists public.focus_goal_links (
  id uuid primary key default gen_random_uuid(),
  goal_id text not null references public.focus_goals(id) on delete cascade,
  task_id text not null references public.focus_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  weight numeric not null default 0,
  unique (goal_id, task_id)
);

create index if not exists focus_goal_links_goal_id_idx on public.focus_goal_links(goal_id);

create or replace function public.focus_goal_links_set_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select user_id into new.user_id from public.focus_goals where id = new.goal_id;
  if new.user_id is null then
    raise exception 'focus_goal_links: goal_id % does not exist', new.goal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists focus_goal_links_set_owner_trg on public.focus_goal_links;
create trigger focus_goal_links_set_owner_trg
  before insert or update on public.focus_goal_links
  for each row execute function public.focus_goal_links_set_owner();

alter table public.focus_goal_links enable row level security;
create policy focus_goal_links_select on public.focus_goal_links for select to authenticated using (auth.uid() = user_id);
create policy focus_goal_links_insert on public.focus_goal_links for insert to authenticated with check (
  exists (select 1 from public.focus_goals g where g.id = goal_id and g.user_id = auth.uid())
);
create policy focus_goal_links_update on public.focus_goal_links for update to authenticated using (auth.uid() = user_id) with check (
  exists (select 1 from public.focus_goals g where g.id = goal_id and g.user_id = auth.uid())
);
create policy focus_goal_links_delete on public.focus_goal_links for delete to authenticated using (auth.uid() = user_id);

-- Historical records -- task_id/entry_id are plain text with no FK, on
-- purpose: a session/execution record should survive its source task or
-- timeline entry being deleted later (the app already denormalizes
-- taskTitle/entryTitle alongside for exactly this reason).
create table if not exists public.focus_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text null,
  task_title text not null,
  category text null,
  duration_min integer not null default 25,
  percentage integer null,
  note text null,
  completed_at timestamptz not null default now()
);

create index if not exists focus_sessions_user_id_idx on public.focus_sessions(user_id);

alter table public.focus_sessions enable row level security;
create policy focus_sessions_select on public.focus_sessions for select to authenticated using (auth.uid() = user_id);
create policy focus_sessions_insert on public.focus_sessions for insert to authenticated with check (auth.uid() = user_id);
create policy focus_sessions_update on public.focus_sessions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy focus_sessions_delete on public.focus_sessions for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.focus_execution_history (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id text null,
  entry_title text not null,
  category text null,
  planned_date date not null,
  planned_time time not null,
  planned_duration_min integer not null default 30,
  execution_pct integer not null default 0 check (execution_pct between 0 and 100),
  note text null,
  executed_at timestamptz not null default now()
);

create index if not exists focus_execution_history_user_id_idx on public.focus_execution_history(user_id);

alter table public.focus_execution_history enable row level security;
create policy focus_execution_history_select on public.focus_execution_history for select to authenticated using (auth.uid() = user_id);
create policy focus_execution_history_insert on public.focus_execution_history for insert to authenticated with check (auth.uid() = user_id);
create policy focus_execution_history_update on public.focus_execution_history for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy focus_execution_history_delete on public.focus_execution_history for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.focus_category_colors (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  color text not null,
  primary key (user_id, category)
);

alter table public.focus_category_colors enable row level security;
create policy focus_category_colors_select on public.focus_category_colors for select to authenticated using (auth.uid() = user_id);
create policy focus_category_colors_insert on public.focus_category_colors for insert to authenticated with check (auth.uid() = user_id);
create policy focus_category_colors_update on public.focus_category_colors for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy focus_category_colors_delete on public.focus_category_colors for delete to authenticated using (auth.uid() = user_id);

insert into public._migrations (filename) values ('0009_focus_dashboard.sql')
  on conflict (filename) do nothing;

commit;
