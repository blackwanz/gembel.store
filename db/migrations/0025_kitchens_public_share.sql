-- 0025_kitchens_public_share.sql
-- Adds a Google-Drive-style "anyone with the link can view" share mode to Stok Dapur
-- (masak.html): the owner flips a switch on their kitchen, and anyone holding
-- https://gembel.store/masak.html?share=<kitchen_id> can view its locations + stock items
-- WITHOUT signing in or being a gembel.store member. Actually adding/editing stock still
-- requires a real account + kitchen_members row, exactly as before -- this migration grants
-- the `anon` role SELECT only, never INSERT/UPDATE/DELETE.
--
-- Why a new column, not a separate token table: kitchens.id is already a server-generated,
-- unguessable uuid (see 0019's design note) -- it already IS a perfectly good share token.
-- Minting a second secret would only add a table with no security benefit.
--
-- IMPORTANT CONTEXT for whoever applies this (see also the two migrations below): every
-- existing policy on these tables is scoped `to authenticated` only. This is the FIRST time
-- this schema grants the `anon` role anything at all. Treat it accordingly.
--
-- Recursion trap this migration deliberately avoids (see 0020_kitchens_rls_recursion.sql):
-- 0020 fixed "infinite recursion detected in policy for relation kitchen_members" by moving
-- cross-table membership checks into a SECURITY DEFINER function (public.user_kitchen_role),
-- because a policy on table A that selects from table B, whose own policy selects back from
-- table A (or from itself), re-triggers RLS forever. The naive way to write the new
-- kitchen_locations/stock_items anon-select policies here would be:
--   using (exists (select 1 from public.kitchens k where k.id = kitchen_locations.kitchen_id
--                  and k.public_share_enabled))
-- That inner `select ... from public.kitchens` is NOT run as the bypass-RLS migration role --
-- it's a normal correlated subquery inside another table's policy, so at query time it goes
-- through kitchens' OWN row-level security same as any other select on kitchens would. That's
-- fine ONLY if kitchens itself already has a policy that lets the current role (anon, running
-- this exact query) see that row -- which this migration also adds (kitchens_select_public
-- below). So there's no actual recursion here (kitchens' anon policy doesn't itself query
-- kitchen_locations or stock_items back), but to keep this as unambiguous and easy to audit
-- as 0020's fix -- and to avoid ever depending on policy evaluation order between two tables --
-- the check is centralized in one SECURITY DEFINER helper, kitchen_is_publicly_shared(uuid),
-- that bypasses RLS internally (same pattern as user_kitchen_role). Every new anon policy below
-- calls that function instead of inlining a cross-table subquery.

begin;

alter table public.kitchens
  add column if not exists public_share_enabled boolean not null default false;

-- SECURITY DEFINER so checking "is kitchen X publicly shared" from a policy on a DIFFERENT
-- table (kitchen_locations, stock_items) never has to depend on that other query's calling
-- role already having its own visibility into `kitchens` -- it looks the flag up directly,
-- bypassing RLS, same rationale as public.user_kitchen_role in 0020.
create or replace function public.kitchen_is_publicly_shared(_kitchen_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select public_share_enabled from public.kitchens where id = _kitchen_id), false);
$$;

grant execute on function public.kitchen_is_publicly_shared(uuid) to anon, authenticated;

-- ---- kitchens ----

-- Anyone (including logged-out/anon) can see a kitchen's own name once it's publicly shared --
-- needed so the ?share=<id> page can render a title / confirm the link is valid at all.
create policy kitchens_select_public on public.kitchens
  for select to anon
  using (public_share_enabled = true);

-- Only the owner can flip the switch. Reuses the existing owner-only kitchens_update policy's
-- USING clause (owner_id = auth.uid()) -- editors/viewers were never allowed to update kitchens
-- at all (0019 never gave them an update policy on this table), so no change needed there:
-- non-owners already can't reach this column. This is just documenting that fact -- the
-- pre-existing kitchens_update policy from 0019 already covers public_share_enabled correctly.

-- ---- kitchen_locations ----

create policy kitchen_locations_select_public on public.kitchen_locations
  for select to anon
  using (public.kitchen_is_publicly_shared(kitchen_id));

-- ---- stock_items ----

create policy stock_items_select_public on public.stock_items
  for select to anon
  using (public.kitchen_is_publicly_shared(kitchen_id));

-- RLS policies alone don't grant anything without the base table GRANT for that role.
grant select on public.kitchens, public.kitchen_locations, public.stock_items to anon;

insert into public._migrations (filename) values ('0025_kitchens_public_share.sql')
  on conflict (filename) do nothing;

commit;
