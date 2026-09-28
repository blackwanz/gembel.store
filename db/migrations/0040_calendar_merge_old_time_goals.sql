-- 0040_calendar_merge_old_time_goals.sql
-- One-off data fix: before 0039 added the 'time' format, some users tracked
-- their daily times with hand-made COUNTER goals, typing the clock as a number
-- (615 = 06:15, 2250 = 22:50, 40 = 00:40, 8.15 = 08:15). After 0039 seeded the
-- default time activities they showed up twice (e.g. "Bangun Jam" + "Bangun").
--
-- For each such old goal: move its entries onto the matching seeded
-- tm_<slug>_<user_id> goal, converting HHMM -> minutes since midnight, then
-- delete the old goal. Only exact name matches with format='counter' are
-- touched; values that don't parse as a valid clock time are left alone
-- (goal kept) so nothing gets silently lost.

begin;

create temporary table _old_time_goals on commit drop as
select g.id as old_id, 'tm_' || m.slug || '_' || g.user_id as new_id
from public.calendar_goals g
join (values
  ('Bangun Jam', 'bangun'), ('Bangun', 'bangun'),
  ('Berangkat Kerja', 'berangkat'),
  ('Pulang Kerja', 'pulang'), ('Pulang', 'pulang'),
  ('Tidur Jam', 'tidur'), ('Tidur', 'tidur')
) as m(label, slug) on lower(g.text) = lower(m.label)
where g.format = 'counter'
  and g.id not like 'tm\_%'
  and exists (select 1 from public.calendar_goals t where t.id = 'tm_' || m.slug || '_' || g.user_id);

-- HHMM (or H.MM) -> minutes; null when it isn't a valid 00:00-23:59 time.
create or replace function pg_temp.hhmm_to_min(v numeric) returns numeric language sql immutable as $$
  select case
    when v is null or v < 0 then null
    when v <> trunc(v) then  -- 8.15 style
      case when trunc(v) <= 23 and round((v - trunc(v)) * 100) <= 59
           then trunc(v) * 60 + round((v - trunc(v)) * 100) end
    when trunc(v / 100) <= 23 and mod(v, 100) <= 59
      then trunc(v / 100) * 60 + mod(v, 100)
  end
$$;

-- Skip any old goal that has an unconvertible value.
delete from _old_time_goals o
where exists (
  select 1 from public.calendar_goal_entries e
  where e.goal_id = o.old_id and e.value is not null and pg_temp.hhmm_to_min(e.value) is null
);

update public.calendar_goal_entries e
set goal_id = o.new_id, value = pg_temp.hhmm_to_min(e.value)
from _old_time_goals o
where e.goal_id = o.old_id;

delete from public.calendar_goals g
using _old_time_goals o
where g.id = o.old_id;

insert into public._migrations (filename) values ('0040_calendar_merge_old_time_goals.sql')
  on conflict (filename) do nothing;

commit;
