-- 0044_jejak.sql
-- Jejak (jejak.html): monthly movement tracker built from files the member exports themselves
-- (Strava bulk export / GPX / TCX / FIT, Mi Fitness & Zepp Life sport CSVs, Google Maps Timeline
-- JSON) or enters by hand. Everything is parsed in the browser; the database only stores the
-- per-activity summary plus a simplified route, the detected stops and km splits, so the analysis
-- pages never need the original files again.
--
--   jejak_activities  one row per trip / workout. kind = lari|jalan|motor|sepeda|lainnya.
--                     dedupe_key = 't:' || floor(start epoch / 60) so re-importing the same export
--                     (or the same ride coming from Strava and Mi Band) doesn't create duplicates.
--                     route  = [[lat, lng, t_offset_s], ...] (<= ~800 points)
--                     stops  = [{lat, lng, at, dur}]   (at/dur in seconds from start)
--                     splits = [seconds per full km, ...]
--                     commute = null (auto from Rumah/Kantor places) | berangkat | pulang | bukan
--   jejak_places      Rumah / Kantor / named checkpoints for point-to-point speed.
--   jejak_settings    office hours (for "telat" checks), fuel estimate, monthly run target.

begin;

create table if not exists public.jejak_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  source text not null default 'manual' check (source in ('strava','gpx','tcx','fit','miband','google','manual')),
  source_type text not null default '' check (length(source_type) <= 60),
  kind text not null default 'lainnya' check (kind in ('lari','jalan','motor','sepeda','lainnya')),
  title text not null default '' check (length(title) <= 200),
  note text not null default '' check (length(note) <= 1000),
  started_at timestamptz not null,
  elapsed_s integer not null default 0 check (elapsed_s >= 0),
  moving_s integer not null default 0 check (moving_s >= 0),
  distance_m numeric(10,1) not null default 0 check (distance_m >= 0),
  elev_gain_m numeric(7,1),
  max_speed_kmh numeric(5,1),
  avg_hr smallint,
  max_hr smallint,
  calories integer,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  route jsonb,
  stops jsonb not null default '[]'::jsonb,
  splits jsonb not null default '[]'::jsonb,
  commute text check (commute in ('berangkat','pulang','bukan')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists jejak_activities_user_time_idx on public.jejak_activities(user_id, started_at desc);

create table if not exists public.jejak_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'titik' check (role in ('rumah','kantor','titik')),
  name text not null check (length(name) between 1 and 60),
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null default 150 check (radius_m between 30 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists jejak_places_user_idx on public.jejak_places(user_id);
-- at most one Rumah and one Kantor per member
create unique index if not exists jejak_places_role_uniq on public.jejak_places(user_id, role) where role <> 'titik';

create table if not exists public.jejak_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  work_start time not null default '08:00',
  work_end time not null default '17:00',
  fuel_kmpl numeric(5,1) not null default 40 check (fuel_kmpl > 0),
  fuel_price integer not null default 10000 check (fuel_price >= 0),
  run_target_km numeric(6,1) not null default 0 check (run_target_km >= 0),
  updated_at timestamptz not null default now()
);

alter table public.jejak_activities enable row level security;
alter table public.jejak_places enable row level security;
alter table public.jejak_settings enable row level security;

drop policy if exists jejak_activities_own on public.jejak_activities;
create policy jejak_activities_own on public.jejak_activities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists jejak_places_own on public.jejak_places;
create policy jejak_places_own on public.jejak_places
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists jejak_settings_own on public.jejak_settings;
create policy jejak_settings_own on public.jejak_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant all on public.jejak_activities, public.jejak_places, public.jejak_settings to authenticated, service_role;

insert into public._migrations (filename) values ('0044_jejak.sql')
  on conflict (filename) do nothing;

commit;
