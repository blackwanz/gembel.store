-- 0012_app_requests_status_values.sql
-- app_requests.status had a leftover CHECK constraint from before the app
-- was rewritten to Indonesian status terms -- it only allowed
-- pending/in_progress/completed/rejected, while every current call site
-- (dashboard.html, admin.html) reads/writes antre/diproses/selesai. This
-- meant every insert from dashboard.html's "request an app" form has been
-- failing outright with a check-constraint violation.
--
-- Old constraint name was singular ("app_request_status_check") on the
-- plural table -- another sign this table predates the migrations
-- directory and was hand-edited via the SQL editor at some point.
--
-- Not remapping any existing rows here: if `select status, count(*) from
-- app_requests group by status;` showed old English values with rows
-- attached, handle those manually first (map pending->antre,
-- in_progress->diproses, completed->selesai; decide case-by-case for any
-- rejected rows, since the current UI has no equivalent status for those)
-- before running this, since the new constraint will reject an UPDATE that
-- tries to leave a row on an old value too.

begin;

alter table public.app_requests drop constraint if exists app_request_status_check;
alter table public.app_requests
  add constraint app_requests_status_check
  check (status = any (array['antre'::text, 'diproses'::text, 'selesai'::text]));

insert into public._migrations (filename) values ('0012_app_requests_status_values.sql')
  on conflict (filename) do nothing;

commit;
