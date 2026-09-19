-- 0028_tournaments.sql
-- Backs tournament.html ("Rally Bracket"): a badminton tournament bracket manager ported from a
-- self-contained prototype (categories, single/double-elim or group-stage formats, team
-- registration, bracket generation, match scoring).
--
-- This app is structurally different from every other per-user app on this site
-- (archery_data, user_progbar_data, habbit_*, etc, all keyed 1:1 on user_id): a tournament is
-- shared/multi-tenant -- one admin runs it, many players register into it, and everyone watches
-- the same bracket. So instead of one row per user, this is:
--
--   tournaments        -- one row per tournament (an admin can run more than one over time, even
--                          though today's UI only ever surfaces "the current one"). `data` jsonb
--                          holds everything the prototype's in-memory state naturally serializes
--                          to EXCEPT the teams themselves (categories' format/settings/groups/
--                          bracket structure, rules text) -- brackets/groups reference team ids,
--                          which stay stable because they ARE tournament_teams.id.
--   tournament_teams    -- one row per registered team, normalized out of `data` so RLS can grant
--                          a non-admin player the ability to insert/delete their OWN registration
--                          without ever being able to touch the tournament's shared blob.
--
-- Admin detection follows the same public.profiles.role = 'admin' convention used elsewhere
-- (see 0007_leaderboard.sql, 0011_app_requests_policies.sql, 0016_payment_requests.sql) --
-- nothing client-side; the prototype's old role-switch toggle is gone.
--
-- Self-registration goes through a SECURITY DEFINER RPC (register_tournament_team) rather than a
-- raw insert policy, because "any authenticated user can insert a row for themselves" is not
-- enough here -- it also has to check registration_open on the PARENT tournament first, and doing
-- that check inside a normal RLS `with check` means re-deriving it per-row anyway. A function makes
-- the "is registration open" rule live in exactly one place and gives the client one clean call
-- (supabase.rpc(...)) instead of an insert that can fail for reasons the client has to guess at.

begin;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  registration_open boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id text not null,
  name text not null,
  registered_by uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tournament_teams_tournament_idx on public.tournament_teams(tournament_id);
create index if not exists tournament_teams_category_idx on public.tournament_teams(tournament_id, category_id);
create index if not exists tournament_teams_registered_by_idx on public.tournament_teams(registered_by);

alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;

-- ---- tournaments ----
-- Watching a tournament (SELECT) is open to any signed-in user -- everyone can see the bracket.
-- Writing (INSERT/UPDATE/DELETE) is admin-only, matching the profiles.role = 'admin' convention.

create policy tournaments_select on public.tournaments
  for select to authenticated
  using (true);

create policy tournaments_insert on public.tournaments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy tournaments_update on public.tournaments
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy tournaments_delete on public.tournaments
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---- tournament_teams ----
-- SELECT: public roster, open to any signed-in user (same reasoning as tournaments_select).
-- INSERT: admins can add/import any team directly; everyone else must go through the
--   register_tournament_team() RPC below (SECURITY DEFINER, bypasses RLS, enforces its own rules).
-- UPDATE: admin-only (status changes, edits, DQ, etc.) -- a player's own row is not editable in
--   place, only insertable (via the RPC) and deletable (withdrawal, below).
-- DELETE: admins can remove any team; a non-admin can withdraw ONLY their own registration, and
--   only while the parent tournament's registration is still open (once the admin closes
--   registration -- typically because a bracket has been generated -- self-withdrawal stops being
--   safe, since it could yank a team out from under an in-progress bracket without going through
--   the admin's withdraw/DQ flow, which also fixes up the bracket).

create policy tournament_teams_select on public.tournament_teams
  for select to authenticated
  using (true);

create policy tournament_teams_insert_admin on public.tournament_teams
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy tournament_teams_update_admin on public.tournament_teams
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy tournament_teams_delete_admin on public.tournament_teams
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy tournament_teams_delete_self on public.tournament_teams
  for delete to authenticated
  using (
    registered_by = auth.uid()
    and exists (
      select 1 from public.tournaments t
      where t.id = tournament_teams.tournament_id and t.registration_open
    )
  );

-- ---- self-registration RPC ----
-- SECURITY DEFINER so it can insert into tournament_teams on the caller's behalf while enforcing
-- the "registration must be open" rule itself, rather than relying on a client that already
-- checked and could be wrong/stale/bypassed. Returns the new row so the client can add it straight
-- into its in-memory state without a follow-up select.

create or replace function public.register_tournament_team(
  p_tournament_id uuid,
  p_category_id text,
  p_name text,
  p_payload jsonb default '{}'::jsonb
)
returns public.tournament_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean;
  v_row public.tournament_teams;
begin
  if auth.uid() is null then
    raise exception 'Harus login untuk mendaftar.';
  end if;

  select registration_open into v_open
  from public.tournaments
  where id = p_tournament_id;

  if v_open is null then
    raise exception 'Turnamen tidak ditemukan.';
  end if;

  if not v_open then
    raise exception 'Pendaftaran untuk turnamen ini sedang ditutup.';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nama tim wajib diisi.';
  end if;

  insert into public.tournament_teams (tournament_id, category_id, name, registered_by, payload)
  values (p_tournament_id, p_category_id, trim(p_name), auth.uid(), coalesce(p_payload, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.register_tournament_team(uuid, text, text, jsonb) to authenticated;

-- Realtime (tournament.html subscribes to postgres_changes on both tables so admin dashboards and
-- player views update live without a manual refresh) -- payment_requests taught us the hard way
-- (0022_payment_requests_realtime.sql) that a table not being in this publication makes the
-- subscription silently do nothing, so both are added here from the start.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments'
  ) then
    alter publication supabase_realtime add table public.tournaments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_teams'
  ) then
    alter publication supabase_realtime add table public.tournament_teams;
  end if;
end $$;

insert into public._migrations (filename) values ('0028_tournaments.sql')
  on conflict (filename) do nothing;

commit;
