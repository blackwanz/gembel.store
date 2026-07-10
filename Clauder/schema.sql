-- ============================================================
-- GEMBEL AI PIK — DATABASE SCHEMA (Supabase / Postgres)
-- ============================================================
-- This file is the source of truth for every supabase.from(...)
-- call in the app. If you rename a column here, grep the JS for
-- the old name before you deploy.
--
-- Built from the JSON schema you provided, with the following
-- additions (each one is called out inline below with WHY):
--   - user_profiles.role / .plan get DEFAULTs + a CHECK, because
--     every page branches on these two columns to decide what to
--     render. A NULL role or plan would break every guard.
--   - apps.plan          (NEW) — lets the catalog be filtered by
--                          what the signed-in user is allowed to
--                          open. Without it there is no way to
--                          answer "what apps can this user use".
--   - apps.app_url        (NEW) — the catalog is unusable without
--                          somewhere to send the user when they
--                          click "Open".
--   - app_request.app_url / .apk_url / .admin_note / .expires_at
--                         (NEW) — dashboard.js (the file you sent)
--                          already reads req.app_url, req.apk_url,
--                          req.admin_note and req.expires_at. These
--                          columns support that existing logic; they
--                          were simply missing from the JSON you sent.
--   - payment_request.flag_premium is typed `text` and holds the
--                          plan name being requested (per your
--                          answer: "premium same as plan"), e.g.
--                          'elite'. Confirming the request copies
--                          this value into user_profiles.plan.
--   - developers          (NEW TABLE) — for the admin landing page's
--                          "developers available" list. You asked
--                          for a real table, not a JSON/JSONB blob.
-- ============================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ------------------------------------------------------------
-- user_profiles
-- One row per authenticated user. user_id mirrors auth.users.id.
-- ------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  bio          text,
  role         text not null default 'member' check (role in ('member', 'admin')),
  plan         text not null default 'free'   check (plan in ('free', 'elite')),
  wallet_type  text default 'nothing' check (wallet_type in ('nothing', 'gopay', 'btc')),
  wallet_number text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_user_profiles_role on public.user_profiles(role);
create index if not exists idx_user_profiles_plan on public.user_profiles(plan);

-- ------------------------------------------------------------
-- apps
-- Catalog of ready-made apps (e.g. Kalender Produktivitas, Neon
-- Flow) gated by plan. start_date/end_date describe when the
-- app is featured/available, not per-user access windows.
-- ------------------------------------------------------------
create table if not exists public.apps (
  apps_id      uuid primary key default gen_random_uuid(),
  apps_desc    text not null,
  plan         text not null default 'free' check (plan in ('free', 'elite')), -- NEW: gates visibility
  app_url      text,                                                          -- NEW: where "Open" sends the user
  icon         text default '📦',                                             -- small nicety, matches existing tool-card look
  title        text not null default 'Untitled App',
  start_date   date,
  end_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_apps_plan on public.apps(plan);

-- ------------------------------------------------------------
-- app_request
-- User-submitted "bikinin gue app X" tickets, tracked by admin.
-- ------------------------------------------------------------
create table if not exists public.app_request (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.user_profiles(user_id) on delete cascade,
  title        text,
  prompt       text not null,
  status       text not null default 'antre' check (status in ('antre', 'diproses', 'selesai')),
  app_url      text,        -- NEW: filled in by admin when status -> selesai
  apk_url      text,        -- NEW: optional APK download once fulfilled
  admin_note   text,        -- NEW: admin-visible-to-user note on the ticket
  expires_at   timestamptz, -- NEW: free-plan access countdown (existing dashboard.js logic depends on this)
  start_date   date,
  end_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_app_request_user_id on public.app_request(user_id);
create index if not exists idx_app_request_status on public.app_request(status);

-- ------------------------------------------------------------
-- payment_request
-- Elite upgrade / plan-change requests, confirmed by admin.
-- ------------------------------------------------------------
create table if not exists public.payment_request (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.user_profiles(user_id) on delete cascade,
  amount        numeric not null check (amount >= 0),
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  flag_premium  text not null default 'elite', -- plan name this payment upgrades the user to
  note          text,
  date_request  date not null default current_date,
  date_confirm  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_payment_request_user_id on public.payment_request(user_id);
create index if not exists idx_payment_request_status on public.payment_request(status);

-- ------------------------------------------------------------
-- developers  (NEW TABLE)
-- Admin-only roster of developers available to pick up tickets.
-- Deliberately simple — adjust freely, this is a first draft.
-- ------------------------------------------------------------
create table if not exists public.developers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact      text,               -- email, phone, or handle — free text on purpose
  skill_tags   text,                -- e.g. "frontend, supabase" — free text, not an array, to keep the admin UI simple
  status       text not null default 'available' check (status in ('available', 'busy', 'offline')),
  assigned_request_id uuid references public.app_request(id) on delete set null, -- ticket they're currently on, if any
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_developers_status on public.developers(status);

-- ------------------------------------------------------------
-- updated_at auto-touch trigger (applied to every table above)
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_apps_updated_at on public.apps;
create trigger trg_apps_updated_at before update on public.apps
  for each row execute function public.set_updated_at();

drop trigger if exists trg_app_request_updated_at on public.app_request;
create trigger trg_app_request_updated_at before update on public.app_request
  for each row execute function public.set_updated_at();

drop trigger if exists trg_payment_request_updated_at on public.payment_request;
create trigger trg_payment_request_updated_at before update on public.payment_request
  for each row execute function public.set_updated_at();

drop trigger if exists trg_developers_updated_at on public.developers;
create trigger trg_developers_updated_at before update on public.developers
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- auto-create user_profiles row on signup
-- (mirrors what the old code implicitly assumed "profiles" did)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (user_id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.user_profiles enable row level security;
alter table public.apps enable row level security;
alter table public.app_request enable row level security;
alter table public.payment_request enable row level security;
alter table public.developers enable row level security;

-- Small helper so policies can check "is this caller an admin"
-- without recursive RLS calls back into user_profiles.
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable set search_path = public;

-- user_profiles: users see/edit their own row; admins see/edit all.
drop policy if exists "user_profiles_select_own_or_admin" on public.user_profiles;
create policy "user_profiles_select_own_or_admin" on public.user_profiles
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "user_profiles_update_own_or_admin" on public.user_profiles;
create policy "user_profiles_update_own_or_admin" on public.user_profiles
  for update using (auth.uid() = user_id or public.is_admin());
  -- NOTE: this lets a member update their own `plan`/`role`. If that's not
  -- desired, split this into a narrower "own, non-plan/role columns only"
  -- policy at the Postgres level, or enforce it in application code by
  -- never sending plan/role from the client-side saveProfile() call
  -- (which is what dashboard.js does — it does not include plan/role
  -- in its update payload).

-- apps: readable by anyone signed in; only admins write.
drop policy if exists "apps_select_authenticated" on public.apps;
create policy "apps_select_authenticated" on public.apps
  for select using (auth.role() = 'authenticated');

drop policy if exists "apps_write_admin_only" on public.apps;
create policy "apps_write_admin_only" on public.apps
  for all using (public.is_admin()) with check (public.is_admin());

-- app_request: users see/insert their own; admins see/update all.
drop policy if exists "app_request_select_own_or_admin" on public.app_request;
create policy "app_request_select_own_or_admin" on public.app_request
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "app_request_insert_own" on public.app_request;
create policy "app_request_insert_own" on public.app_request
  for insert with check (auth.uid() = user_id);

drop policy if exists "app_request_update_admin_only" on public.app_request;
create policy "app_request_update_admin_only" on public.app_request
  for update using (public.is_admin());

-- payment_request: users see/insert their own; admins see/update all.
drop policy if exists "payment_request_select_own_or_admin" on public.payment_request;
create policy "payment_request_select_own_or_admin" on public.payment_request
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "payment_request_insert_own" on public.payment_request;
create policy "payment_request_insert_own" on public.payment_request
  for insert with check (auth.uid() = user_id);

drop policy if exists "payment_request_update_admin_only" on public.payment_request;
create policy "payment_request_update_admin_only" on public.payment_request
  for update using (public.is_admin());

-- developers: admin-only, full stop.
drop policy if exists "developers_admin_only" on public.developers;
create policy "developers_admin_only" on public.developers
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- REALTIME
-- Needed because dashboard.js / admin.js subscribe to postgres_changes.
-- ============================================================
alter publication supabase_realtime add table public.app_request;
alter publication supabase_realtime add table public.user_profiles;
alter publication supabase_realtime add table public.payment_request;
alter publication supabase_realtime add table public.developers;

-- ============================================================
-- SEED DATA (optional — safe to delete this section)
-- ============================================================
insert into public.apps (apps_desc, plan, app_url, icon, title)
values
  ('App bawaan — goals harian, tracking angka, dan progress bulanan. Selalu aktif, gratis buat semua member.',
   'free', 'apps/calendar/calendar.html', '📅', 'Kalender Produktivitas'),
  ('Progress tracker gaya cyberpunk — lacak sesi kerja lo per warna (fokus/istirahat/lainnya) sampai target waktu harian.',
   'free', 'apps/progbar/progbar.html', '⚡', 'Neon Flow — Time Tracker')
on conflict do nothing;
