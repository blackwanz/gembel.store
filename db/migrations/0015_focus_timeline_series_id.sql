-- 0015_focus_timeline_series_id.sql
-- Adds the series_id column focus_timeline_entries was missing. The client already tags every
-- occurrence of a repeating schedule entry with a shared seriesId (see focus.html's repeat-entry
-- generator) -- that's what lets deleteScheduleEntry() offer "delete just this one / this and
-- following / all occurrences" instead of guessing. But pushCloudData()/pullCloudData() never
-- read or wrote it, so it only ever lived in localStorage: the very next cloud pull (page
-- reload, another device/tab, even this tab's own realtime echo of an unrelated save) silently
-- dropped it, making every occurrence look like a standalone entry and collapsing the delete
-- flow down to a plain "delete just this one" confirm with no series options ever shown.

begin;

alter table public.focus_timeline_entries
  add column if not exists series_id text null;

create index if not exists focus_timeline_entries_series_id_idx on public.focus_timeline_entries(series_id) where series_id is not null;

insert into public._migrations (filename) values ('0015_focus_timeline_series_id.sql')
  on conflict (filename) do nothing;

commit;
