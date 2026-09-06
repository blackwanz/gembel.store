-- 0020_kitchens_rls_recursion.sql
-- Fixes "infinite recursion detected in policy for relation kitchen_members" from
-- 0019_kitchens.sql: several policies checked kitchen membership by selecting from
-- kitchen_members from WITHIN a policy defined ON kitchen_members itself (or, for
-- kitchen_locations/stock_items/kitchen_invites, by selecting from kitchen_members inside
-- THEIR policies -- which still hits kitchen_members' own broken policy on the way in).
-- Postgres re-applies RLS to that inner select, which re-triggers the same policy, forever.
--
-- Fix: a SECURITY DEFINER function bypasses RLS for its own internal query (it runs as its
-- owner -- the migration-running role, which has BYPASSRLS -- rather than as the calling
-- user), so looking up "what role does auth.uid() have in this kitchen" through it never
-- re-enters kitchen_members' RLS at all. Every policy that used to inline that lookup now
-- calls this function instead.

begin;

create or replace function public.user_kitchen_role(_kitchen_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.kitchen_members
  where kitchen_id = _kitchen_id and user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.user_kitchen_role(uuid) to authenticated;

-- ---- kitchens ----

alter policy kitchens_select on public.kitchens
  using (public.user_kitchen_role(id) is not null);

-- ---- kitchen_members (the actual source of the recursion) ----

alter policy kitchen_members_select on public.kitchen_members
  using (public.user_kitchen_role(kitchen_id) is not null);

alter policy kitchen_members_delete on public.kitchen_members
  using (
    role <> 'owner'
    and public.user_kitchen_role(kitchen_id) = 'owner'
  );

-- ---- kitchen_locations ----

alter policy kitchen_locations_select on public.kitchen_locations
  using (public.user_kitchen_role(kitchen_id) is not null);

alter policy kitchen_locations_write on public.kitchen_locations
  with check (public.user_kitchen_role(kitchen_id) in ('owner', 'editor'));

alter policy kitchen_locations_delete on public.kitchen_locations
  using (public.user_kitchen_role(kitchen_id) in ('owner', 'editor'));

-- ---- stock_items ----

alter policy stock_items_select on public.stock_items
  using (public.user_kitchen_role(kitchen_id) is not null);

alter policy stock_items_insert on public.stock_items
  with check (
    created_by = auth.uid()
    and public.user_kitchen_role(kitchen_id) in ('owner', 'editor')
  );

alter policy stock_items_delete on public.stock_items
  using (public.user_kitchen_role(kitchen_id) in ('owner', 'editor'));

-- ---- kitchen_invites ----

alter policy kitchen_invites_select on public.kitchen_invites
  using (
    accepted_by is null
    or public.user_kitchen_role(kitchen_id) is not null
  );

alter policy kitchen_invites_insert on public.kitchen_invites
  with check (
    created_by = auth.uid()
    and public.user_kitchen_role(kitchen_id) = 'owner'
  );

insert into public._migrations (filename) values ('0020_kitchens_rls_recursion.sql')
  on conflict (filename) do nothing;

commit;
