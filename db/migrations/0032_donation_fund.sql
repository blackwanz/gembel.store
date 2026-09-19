-- 0032_donation_fund.sql
-- Backs a new simple donation-tracking app (donasi.html): a QRIS code for people to scan and
-- give to, a donor list, and monthly in/out bookkeeping for money set aside for elderly parents.
-- Same "owner + added members + public share link" shape as Stok Dapur (0019_kitchens.sql,
-- 0025_kitchens_public_share.sql) -- public by default here, not opt-in, since the whole point
-- is a link the owner can send to donors so THEY can see where the money went without an
-- account. Written with the recursion-safe SECURITY DEFINER helper pattern from the start
-- (0020_kitchens_rls_recursion.sql fixed this the hard way for kitchens; no need to repeat that
-- here).

begin;

create table if not exists public.donation_funds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  qris_image_url text null,
  public_share_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.donation_members (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.donation_funds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  unique (fund_id, user_id)
);

-- type='in' is a donation received (donor_name populated -- this is "list donatur"); type='out'
-- is money spent. No running balance column on purpose: "saldo bulan ini aja" (this MONTH's
-- balance only, not all-time) is computed client-side as sum(in) - sum(out) filtered to the
-- current calendar month, same derive-don't-store approach this app already uses elsewhere
-- (habbit.html's monthly totals, focus.html's goal progress).
create table if not exists public.donation_entries (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.donation_funds(id) on delete cascade,
  type text not null check (type in ('in', 'out')),
  amount numeric not null check (amount > 0),
  donor_name text null,
  note text null,
  occurred_on date not null default current_date,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists donation_entries_fund_date_idx on public.donation_entries(fund_id, occurred_on desc);
create index if not exists donation_members_user_idx on public.donation_members(user_id);

alter table public.donation_funds enable row level security;
alter table public.donation_members enable row level security;
alter table public.donation_entries enable row level security;

create or replace function public.donation_fund_role(_fund_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.donation_members
  where fund_id = _fund_id and user_id = auth.uid()
  limit 1;
$$;
grant execute on function public.donation_fund_role(uuid) to authenticated;

create or replace function public.donation_fund_is_public(_fund_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select public_share_enabled from public.donation_funds where id = _fund_id), false);
$$;
grant execute on function public.donation_fund_is_public(uuid) to anon, authenticated;

-- ---- donation_funds ----
create policy donation_funds_select on public.donation_funds
  for select to authenticated
  using (owner_id = auth.uid() or public.donation_fund_role(id) is not null);
create policy donation_funds_select_public on public.donation_funds
  for select to anon
  using (public.donation_fund_is_public(id));
create policy donation_funds_insert on public.donation_funds
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy donation_funds_update on public.donation_funds
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy donation_funds_delete on public.donation_funds
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---- donation_members ----
create policy donation_members_select on public.donation_members
  for select to authenticated
  using (public.donation_fund_role(fund_id) is not null or exists (
    select 1 from public.donation_funds f where f.id = fund_id and f.owner_id = auth.uid()
  ));
create policy donation_members_insert on public.donation_members
  for insert to authenticated
  with check (exists (select 1 from public.donation_funds f where f.id = fund_id and f.owner_id = auth.uid()));
create policy donation_members_delete on public.donation_members
  for delete to authenticated
  using (exists (select 1 from public.donation_funds f where f.id = fund_id and f.owner_id = auth.uid()));

-- ---- donation_entries ----
create policy donation_entries_select on public.donation_entries
  for select to authenticated
  using (
    public.donation_fund_role(fund_id) is not null
    or exists (select 1 from public.donation_funds f where f.id = fund_id and f.owner_id = auth.uid())
  );
create policy donation_entries_select_public on public.donation_entries
  for select to anon
  using (public.donation_fund_is_public(fund_id));
create policy donation_entries_insert on public.donation_entries
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (public.donation_fund_role(fund_id) = 'owner' or public.donation_fund_role(fund_id) = 'editor'
      or exists (select 1 from public.donation_funds f where f.id = fund_id and f.owner_id = auth.uid()))
  );
create policy donation_entries_delete on public.donation_entries
  for delete to authenticated
  using (
    public.donation_fund_role(fund_id) = 'owner'
    or exists (select 1 from public.donation_funds f where f.id = fund_id and f.owner_id = auth.uid())
  );

grant select on public.donation_funds, public.donation_entries to anon;

-- The owner only ever has a member's EMAIL to add them by (same situation as
-- 0031_archery_gifts.sql's gift_archery_arrows) -- a plain user has no RLS-safe way to query
-- auth.users by email directly, so this SECURITY DEFINER function does the lookup + insert in
-- one step, enforcing "only the fund's owner may add members" itself rather than relying on a
-- separate insert policy that would need the same lookup done client-side first.
create or replace function public.donation_add_member_by_email(_fund_id uuid, _email text, _role text default 'editor')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from public.donation_funds where id = _fund_id and owner_id = auth.uid()) then
    raise exception 'Cuma pemilik dana ini yang bisa nambah anggota.';
  end if;
  if _role not in ('owner', 'editor') then
    raise exception 'Role gak valid.';
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(_email)) limit 1;
  if v_user_id is null then
    raise exception 'Gak ada user aktif dengan email itu.';
  end if;
  insert into public.donation_members (fund_id, user_id, role)
  values (_fund_id, v_user_id, _role)
  on conflict (fund_id, user_id) do update set role = excluded.role;
  return v_user_id;
end;
$$;
grant execute on function public.donation_add_member_by_email(uuid, text, text) to authenticated;

-- Storage for the QRIS image itself -- public bucket (not signed-URL-gated like save-files),
-- since the whole point is a logged-out visitor being able to load and scan it directly from
-- the share link.
insert into storage.buckets (id, name, public, file_size_limit)
values ('donation-qris', 'donation-qris', true, 5242880)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = true;

drop policy if exists donation_qris_storage_select on storage.objects;
create policy donation_qris_storage_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'donation-qris');

-- Any authenticated user can upload/replace/delete within this bucket (same simple shared-bucket
-- trust model as save-files' storage policies) -- the real access boundary that matters (who can
-- attach an image to a SPECIFIC fund) is enforced by donation_funds_update above, since setting
-- qris_image_url on a fund row still requires owning that fund.
drop policy if exists donation_qris_storage_insert on storage.objects;
create policy donation_qris_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'donation-qris' and owner = auth.uid());
drop policy if exists donation_qris_storage_delete on storage.objects;
create policy donation_qris_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'donation-qris' and owner = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'donation_entries'
  ) then
    alter publication supabase_realtime add table public.donation_entries;
  end if;
end $$;

insert into public._migrations (filename) values ('0032_donation_fund.sql')
  on conflict (filename) do nothing;

commit;
