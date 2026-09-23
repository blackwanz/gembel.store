-- 0037_notifications_read_state.sql
-- Notifications used to live only inside dashboard.html's "Request App Kamu" list, with no
-- read/unread state -- easy to miss, especially a maintenance notice. assets/notif-bell.js now
-- gives every logged-in page a 🔔 bell with an unread badge + its own panel, and shows an unread
-- kind='maintenance' notification as a top banner until the user acknowledges it. Both need to
-- know what the user has already seen, so:
--
--   read_at   null = unread. Set by the user (clicking an item, "tandai semua dibaca", or
--             dismissing the maintenance banner).
--
-- Access: a user may UPDATE their own rows, but only the read_at column -- the column-level
-- grant below keeps them from rewriting title/message/kind/link_url of their own copy (the
-- row-level policy alone can't restrict which columns change).
--
-- kind='maintenance' is new (admin.html's blast form can now pick it); no constraint on kind
-- exists, so nothing to alter for that.

begin;

alter table public.notifications add column if not exists read_at timestamptz null;

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id) where read_at is null;

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

insert into public._migrations (filename) values ('0037_notifications_read_state.sql')
  on conflict (filename) do nothing;

commit;
