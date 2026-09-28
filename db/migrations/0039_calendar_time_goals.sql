-- 0039_calendar_time_goals.sql
-- Kalender: new goal format 'time' (log the clock time an activity happened,
-- 24h "HH:MM"), with a per-goal default time and an optional "red" limit --
-- an entry logged LATER than red_limit renders red on the calendar.
--
-- Entry values for 'time' goals are stored in calendar_goal_entries.value as
-- minutes since midnight (09:30 -> 570), so the numeric column is reused.
--
-- Also seeds the 4 default time activities for every existing user. Ids are
-- deterministic per user ('tm_<slug>_<user_id>') -- calendar.html uses the
-- same ids for brand-new accounts, so the two never duplicate each other.

begin;

alter table public.calendar_goals drop constraint if exists calendar_goals_format_check;
alter table public.calendar_goals
  add constraint calendar_goals_format_check check (format in ('counter', 'hours', 'time'));

alter table public.calendar_goals add column if not exists default_time text not null default '';
alter table public.calendar_goals add column if not exists red_limit text not null default '';

insert into public.calendar_goals (id, user_id, text, hidden, track_value, format, unit, default_time, red_limit, sort_order)
select 'tm_' || d.slug || '_' || u.id, u.id, d.label, false, true, 'time', '', d.default_time, '', d.ord
from auth.users u
cross join (values
  ('bangun',    'Bangun',          '06:00', -4),
  ('berangkat', 'Berangkat Kerja', '09:30', -3),
  ('pulang',    'Pulang',          '09:30', -2),
  ('tidur',     'Tidur',           '22:10', -1)
) as d(slug, label, default_time, ord)
on conflict (id) do nothing;

insert into public._migrations (filename) values ('0039_calendar_time_goals.sql')
  on conflict (filename) do nothing;

commit;
