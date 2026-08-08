-- db/backfill_calendar.sql
--
-- One-time copy of existing user_calendar_data rows (the old
-- one-JSONB-blob-per-user table: goals[], progress{}, theme) into the new
-- normalized calendar_goals / calendar_goal_entries / calendar_settings
-- tables from 0002_calendar.sql.
--
-- Run this AFTER 0001_init.sql/0002_calendar.sql/0003_habbit.sql have been
-- applied, and BEFORE deploying the rewritten calendar.html that reads from
-- the new tables -- otherwise existing users lose their goals/history.
--
-- Idempotent: skips any user_id that already has a calendar_goals row, so
-- it's safe to run more than once (e.g. after fixing a data issue and
-- re-running).
--
-- calendar_goals.id/calendar_goal_entries.id are TEXT (see 0002_calendar.sql),
-- matching the app's own client-generated ids -- so old goal ids from the
-- blob are reused verbatim, no id remapping needed.
--
-- Known limitation: progress keys use the app's own 'date-{y}-{m}-{d}'
-- format; any row still carrying the very old one-off 'jun-{d}' legacy keys
-- (only relevant if a user's last cloud sync predates that in-app
-- migration) is skipped rather than guessed at -- check the app's own
-- migrateOldDatabaseFormat() comment in the previous calendar.html if any
-- of those ever need manual recovery.

do $$
declare
  ucd record;
  goal jsonb;
  goal_ids text[];
  prog record;
  entry jsonb;
  entry_id text;
  entry_row_id text;
  entry_value numeric;
  date_match text[];
  y int;
  m int;
  d int;
  synthetic_counter int := 0;
begin
  for ucd in select * from public.user_calendar_data loop
    if exists (select 1 from public.calendar_goals where user_id = ucd.user_id) then
      continue; -- already backfilled
    end if;

    goal_ids := array[]::text[]; -- ids actually inserted, so orphaned progress entries can be skipped

    if ucd.goals is not null then
      for goal in select * from jsonb_array_elements(ucd.goals) loop
        if goal->>'id' is null then
          continue; -- malformed entry, nothing to key it by
        end if;

        insert into public.calendar_goals (id, user_id, text, hidden, track_value, format, unit)
        values (
          goal->>'id',
          ucd.user_id,
          coalesce(goal->>'text', ''),
          coalesce((goal->>'hidden')::boolean, false),
          coalesce((goal->>'trackValue')::boolean, false),
          coalesce(goal->>'format', case when goal->>'unit' = 'jam' then 'hours' else 'counter' end),
          coalesce(goal->>'unit', '')
        )
        on conflict (id) do nothing;

        goal_ids := array_append(goal_ids, goal->>'id');
      end loop;
    end if;

    if ucd.progress is not null then
      for prog in select key, value from jsonb_each(ucd.progress) loop
        date_match := regexp_match(prog.key, '^date-(\d+)-(\d+)-(\d+)$');
        if date_match is null then
          continue; -- unrecognized/legacy key format, see note above
        end if;
        y := date_match[1]::int;
        m := date_match[2]::int;
        d := date_match[3]::int;

        for entry in select * from jsonb_array_elements(prog.value) loop
          if jsonb_typeof(entry) = 'string' then
            entry_id := trim(both '"' from entry::text);
            entry_value := null;
          else
            entry_id := entry->>'id';
            entry_value := nullif(entry->>'value', '')::numeric;
          end if;

          if entry_id is null or not (entry_id = any (goal_ids)) then
            continue; -- points at a goal that no longer exists in this blob
          end if;

          -- Reuse the entry's own entryId if the blob already has one
          -- (post-migrateProgressEntries clients do); otherwise mint a
          -- stable synthetic id so this loop iteration never collides with
          -- another one.
          synthetic_counter := synthetic_counter + 1;
          entry_row_id := coalesce(entry->>'entryId', 'bf_' || ucd.user_id || '_' || synthetic_counter);

          insert into public.calendar_goal_entries (id, goal_id, user_id, entry_date, value)
          values (entry_row_id, entry_id, ucd.user_id, make_date(y, m, d), entry_value)
          on conflict (id) do nothing;
        end loop;
      end loop;
    end if;

    insert into public.calendar_settings (user_id, theme)
    values (ucd.user_id, coalesce(ucd.theme, 'light'))
    on conflict (user_id) do update set theme = excluded.theme;
  end loop;
end $$;
