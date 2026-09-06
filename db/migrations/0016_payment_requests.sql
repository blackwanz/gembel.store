-- 0016_payment_requests.sql
-- payment_requests was one of the "pre-existing" tables 0001_init.sql explicitly left out of
-- scope (assumed to already have its schema set up outside git, same as app_requests before
-- 0011). It didn't actually exist at all: submitting a payment (dashboard.html/index.html's
-- openPaymentModal, in auth.js) failed with PostgREST's "Could not find the table
-- 'public.payment_requests' in the schema cache" -- surfaced to the user as a raw native
-- alert() with no fallback, even though there's already a QRIS image (assets/payment-qr.png)
-- meant for exactly this "automated flow is down, pay manually" case.
--
-- Access pattern derived from actual usage (same convention as app_requests, 0011):
--   dashboard.html/index.html: insert own row, read own rows
--   admin.html:                select all rows, update status ('pending'|'confirmed'|'rejected')
--   (nothing ever deletes a row)

begin;

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists payment_requests_user_id_idx on public.payment_requests(user_id);

alter table public.payment_requests enable row level security;

create policy payment_requests_select on public.payment_requests
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy payment_requests_insert on public.payment_requests
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy payment_requests_update on public.payment_requests
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public._migrations (filename) values ('0016_payment_requests.sql')
  on conflict (filename) do nothing;

commit;
