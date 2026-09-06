-- 0017_notifications.sql
-- Backs a new admin -> member notification/announcement feature: admin.html gets a "Notifikasi"
-- tab to compose a message and blast it to every member (one row per recipient, same
-- one-row-per-user shape as app_requests/payment_requests rather than a single shared broadcast
-- row + per-user read-state join table -- keeps deleting "mine" trivially independent of anyone
-- else's copy, consistent with how every other per-user list in this app already works).
-- Notifications render inside dashboard.html's "Request App Kamu" list, so they double as an
-- in-context notice rather than a separate inbox no one checks.
--
-- Access pattern:
--   dashboard.html: select own rows, delete own rows (never inserts/updates)
--   admin.html:     insert one row per recipient when blasting (never reads/updates/deletes)

begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_idx on public.notifications(user_id);

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (auth.uid() = user_id);

create policy notifications_delete on public.notifications
  for delete to authenticated
  using (auth.uid() = user_id);

create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- app_requests never got a delete policy (0011_app_requests_policies.sql only covers
-- select/insert/update) -- dashboard.html is about to let a user delete their own request the
-- same way they can delete a notification, so it needs one now too.
create policy app_requests_delete on public.app_requests
  for delete to authenticated
  using (auth.uid() = user_id);

insert into public._migrations (filename) values ('0017_notifications.sql')
  on conflict (filename) do nothing;

commit;
