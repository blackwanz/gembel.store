-- 0014_focus_tasks_pinned_archived.sql
-- Adds the "pin" and "archive" flags the Focus Dashboard UI already lets users set
-- (kanban card pin/archive, long-term goal pin) but which pushCloudData()/pullCloudData()
-- weren't yet reading/writing -- meaning they only ever lived in localStorage and were
-- silently reset back to defaults on the very next cloud pull (page reload, another
-- device/tab, or even the app's own realtime echo of an unrelated edit). These columns are
-- what focus.html's push/pull mappings now round-trip so pin/archive state actually persists.

begin;

alter table public.focus_tasks
  add column if not exists archived boolean not null default false,
  add column if not exists pinned boolean not null default false;

alter table public.focus_goals
  add column if not exists pinned boolean not null default false;

insert into public._migrations (filename) values ('0014_focus_tasks_pinned_archived.sql')
  on conflict (filename) do nothing;

commit;
