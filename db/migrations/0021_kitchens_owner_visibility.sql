-- 0021_kitchens_owner_visibility.sql
-- Fixes "new row violates row-level security policy for table kitchens" when creating a kitchen.
--
-- masak.html's createKitchen() does `.from('kitchens').insert({...}).select().single()` --
-- the RETURNING that .select() implies is governed by the table's SELECT policy, not just the
-- INSERT policy's WITH CHECK. kitchens_select (from 0019, untouched by 0020's recursion fix)
-- only granted visibility via an existing kitchen_members row -- but that row is only inserted
-- in the NEXT step of createKitchen(), after the kitchens insert has already returned. So the
-- brand-new kitchen briefly fails its own SELECT policy at the exact moment it's created.
--
-- Fix: an owner can always see a kitchen they own, full stop, independent of whether a
-- kitchen_members row exists yet -- this is true anyway and doesn't need the membership lookup.

begin;

alter policy kitchens_select on public.kitchens
  using (
    owner_id = auth.uid()
    or public.user_kitchen_role(id) is not null
  );

insert into public._migrations (filename) values ('0021_kitchens_owner_visibility.sql')
  on conflict (filename) do nothing;

commit;
