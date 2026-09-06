-- 0019_kitchens.sql
-- Backs masak.html ("Stok Dapur"): kitchen stock tracking that's shareable between people --
-- e.g. two siblings splitting a kos, each with their own kitchen but able to invite the other
-- in with either edit or view-only access, and one person can belong to several kitchens (their
-- own kos + an occasional guest spot at someone else's).
--
-- Access pattern:
--   masak.html: everything below, scoped to kitchens the signed-in user is a member of.
--   No admin.html involvement -- this app is entirely peer-to-peer, not admin-moderated.
--
-- Design notes:
--   * A brand-new user has zero kitchens. masak.html's first-run flow inserts one `kitchens`
--     row (owner_id = self) + one `kitchen_members` row (role='owner') + four default
--     `kitchen_locations` rows (Kulkas/Freezer/Rak Bumbu/Meja) client-side, in that order.
--   * People are added via `kitchen_invites`, not by looking up another user's email/id
--     directly (auth.users isn't queryable from the client) -- the owner generates a short
--     random code for a chosen role (editor/viewer), shares it out-of-band (chat, verbally),
--     and the invitee "redeems" it under their own account: insert their own row into
--     kitchen_members (allowed by kitchen_members_insert_invite below, which checks a live
--     invite exists for that kitchen+role) then mark the invite accepted. Codes aren't
--     enumerable-but-secret in the security sense (this is a household app, not a bank), just
--     unguessable enough to not be typed in by accident.
--   * stock_items.location is a plain text column matching a kitchen_locations.name, not a
--     foreign key -- keeps the common case (add/list/filter stock) a single-table query, at
--     the cost of the app itself (not the DB) having to stop someone deleting a location that
--     still has items in it.

begin;

create table if not exists public.kitchens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.kitchen_members (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (kitchen_id, user_id)
);

create table if not exists public.kitchen_locations (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (kitchen_id, name)
);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  name text not null,
  category text not null default 'Lainnya',
  location text not null,
  qty numeric not null default 1,
  unit text not null default 'buah',
  bought_at date not null default current_date,
  shelf_life_days integer not null default 7,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.kitchen_invites (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  code text not null unique,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);

create index if not exists kitchen_members_kitchen_idx on public.kitchen_members(kitchen_id);
create index if not exists kitchen_members_user_idx on public.kitchen_members(user_id);
create index if not exists kitchen_locations_kitchen_idx on public.kitchen_locations(kitchen_id);
create index if not exists stock_items_kitchen_idx on public.stock_items(kitchen_id);
create index if not exists kitchen_invites_kitchen_idx on public.kitchen_invites(kitchen_id);
create index if not exists kitchen_invites_code_idx on public.kitchen_invites(code);

alter table public.kitchens enable row level security;
alter table public.kitchen_members enable row level security;
alter table public.kitchen_locations enable row level security;
alter table public.stock_items enable row level security;
alter table public.kitchen_invites enable row level security;

-- ---- kitchens ----

create policy kitchens_select on public.kitchens
  for select to authenticated
  using (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = kitchens.id and km.user_id = auth.uid()
  ));

create policy kitchens_insert on public.kitchens
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy kitchens_update on public.kitchens
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---- kitchen_members ----

create policy kitchen_members_select on public.kitchen_members
  for select to authenticated
  using (exists (
    select 1 from public.kitchen_members self
    where self.kitchen_id = kitchen_members.kitchen_id and self.user_id = auth.uid()
  ));

-- Bootstrapping a brand-new kitchen: the creator adds themselves as its first (owner) member.
create policy kitchen_members_insert_owner on public.kitchen_members
  for insert to authenticated
  with check (
    user_id = auth.uid() and role = 'owner'
    and exists (select 1 from public.kitchens k where k.id = kitchen_members.kitchen_id and k.owner_id = auth.uid())
  );

-- Redeeming an invite: the invitee adds themselves at the role a live invite grants.
create policy kitchen_members_insert_invite on public.kitchen_members
  for insert to authenticated
  with check (
    user_id = auth.uid() and role in ('editor', 'viewer')
    and exists (
      select 1 from public.kitchen_invites ki
      where ki.kitchen_id = kitchen_members.kitchen_id
        and ki.role = kitchen_members.role
        and ki.accepted_by is null
        and ki.expires_at > now()
    )
  );

create policy kitchen_members_delete on public.kitchen_members
  for delete to authenticated
  using (
    role <> 'owner'
    and exists (
      select 1 from public.kitchen_members me
      where me.kitchen_id = kitchen_members.kitchen_id and me.user_id = auth.uid() and me.role = 'owner'
    )
  );

-- ---- kitchen_locations ----

create policy kitchen_locations_select on public.kitchen_locations
  for select to authenticated
  using (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = kitchen_locations.kitchen_id and km.user_id = auth.uid()
  ));

create policy kitchen_locations_write on public.kitchen_locations
  for insert to authenticated
  with check (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = kitchen_locations.kitchen_id and km.user_id = auth.uid() and km.role in ('owner', 'editor')
  ));

create policy kitchen_locations_delete on public.kitchen_locations
  for delete to authenticated
  using (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = kitchen_locations.kitchen_id and km.user_id = auth.uid() and km.role in ('owner', 'editor')
  ));

-- ---- stock_items ----

create policy stock_items_select on public.stock_items
  for select to authenticated
  using (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = stock_items.kitchen_id and km.user_id = auth.uid()
  ));

create policy stock_items_insert on public.stock_items
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.kitchen_members km
      where km.kitchen_id = stock_items.kitchen_id and km.user_id = auth.uid() and km.role in ('owner', 'editor')
    )
  );

create policy stock_items_delete on public.stock_items
  for delete to authenticated
  using (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = stock_items.kitchen_id and km.user_id = auth.uid() and km.role in ('owner', 'editor')
  ));

-- ---- kitchen_invites ----

create policy kitchen_invites_select on public.kitchen_invites
  for select to authenticated
  using (
    accepted_by is null
    or exists (
      select 1 from public.kitchen_members km
      where km.kitchen_id = kitchen_invites.kitchen_id and km.user_id = auth.uid()
    )
  );

create policy kitchen_invites_insert on public.kitchen_invites
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.kitchen_members km
      where km.kitchen_id = kitchen_invites.kitchen_id and km.user_id = auth.uid() and km.role = 'owner'
    )
  );

-- Redeeming: any authenticated user can claim an unaccepted, unexpired invite for themselves.
create policy kitchen_invites_accept on public.kitchen_invites
  for update to authenticated
  using (accepted_by is null and expires_at > now())
  with check (accepted_by = auth.uid());

insert into public._migrations (filename) values ('0019_kitchens.sql')
  on conflict (filename) do nothing;

commit;
