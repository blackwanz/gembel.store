-- 0011_app_requests_policies.sql
-- app_requests is one of the "pre-existing" tables 0001_init.sql explicitly
-- left out of scope (assumed to already have its RLS set up outside git).
-- It didn't -- RLS is enabled on it with zero policies, which means
-- deny-all for every role (same mechanism as _migrations' intentional
-- lockout, just unintentional here): every select/insert/update from the
-- browser has been failing with 403, both for regular users submitting a
-- request (dashboard.html) and for admin managing them (admin.html).
--
-- Access pattern derived from actual usage:
--   dashboard.html: select own rows (eq user_id), insert own row
--   admin.html:     select all rows, update status/app_url/apk_url/seen_by_admin
--   (nothing ever deletes a row)
-- Admin check follows the same profiles.role = 'admin' convention as
-- leaderboard_points (0007_leaderboard.sql) -- there's no JWT role claim.

begin;

create policy app_requests_select on public.app_requests
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy app_requests_insert on public.app_requests
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy app_requests_update on public.app_requests
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public._migrations (filename) values ('0011_app_requests_policies.sql')
  on conflict (filename) do nothing;

commit;
