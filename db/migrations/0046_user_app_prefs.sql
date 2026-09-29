-- 0046_user_app_prefs.sql
-- Per-member customisation of the built-in app tiles on dashboard.html: pin to the top, rename,
-- rewrite the description, move to a different (or brand-new) category, or hide. The canonical
-- name/desc/category still live in assets/apps.config.js; a row here only stores the member's
-- overrides, and a null column means "use the default". app_id is the `id` from apps.config.js
-- (not a foreign key -- that registry is a JS file, not a table).

begin;

create table if not exists public.user_app_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null check (length(app_id) between 1 and 64),
  pinned_at timestamptz,
  custom_name text check (length(custom_name) between 1 and 80),
  custom_desc text check (length(custom_desc) <= 500),
  custom_category text check (length(custom_category) between 1 and 40),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, app_id)
);

alter table public.user_app_prefs enable row level security;

drop policy if exists user_app_prefs_select on public.user_app_prefs;
create policy user_app_prefs_select on public.user_app_prefs
  for select using (auth.uid() = user_id);
drop policy if exists user_app_prefs_insert on public.user_app_prefs;
create policy user_app_prefs_insert on public.user_app_prefs
  for insert with check (auth.uid() = user_id);
drop policy if exists user_app_prefs_update on public.user_app_prefs;
create policy user_app_prefs_update on public.user_app_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists user_app_prefs_delete on public.user_app_prefs;
create policy user_app_prefs_delete on public.user_app_prefs
  for delete using (auth.uid() = user_id);

grant all on public.user_app_prefs to authenticated, service_role;

commit;
