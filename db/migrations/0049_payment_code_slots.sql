-- 0049_payment_code_slots.sql
-- The Saweria unique code (0018) used to be a random 0-999 picked by the browser
-- (assets/payment-saweria.js). Two problems with that: collisions were only caught by the unique
-- index on pending amounts (the insert just failed), and a random code makes the amount look
-- arbitrary (Rp 20.907) when it could stay small (Rp 20.000).
--
-- Now the database hands out the codes:
--   * payment_code_slots holds one row per code currently in use (primary key on code, so a code
--     can never be handed out twice).
--   * A BEFORE INSERT trigger on payment_requests picks the SMALLEST free code 1..999, so the
--     amount is base + 1, base + 2, ... (max 19.999 + 999 = 20.998 for one month) and writes the
--     real amount/unique_code/expires_at onto the row -- whatever the browser sent is overwritten.
--   * An AFTER UPDATE trigger deletes the slot as soon as the row leaves 'pending' (confirmed,
--     rejected, expired), so code 1 is free again for the next person.
--   * Stale slots (expired, or their row already settled) are also cleared at allocation time,
--     so a stopped saweria-listener sweep can't leak codes. Pending rows past expires_at are
--     flipped to 'expired' first, otherwise reusing their code would hit
--     payment_requests_pending_amount_idx.
--   * Allocation takes a transaction-level advisory lock, so two people paying at the same moment
--     get different codes instead of one of them failing.
-- All 999 codes busy at once -> the insert raises, auth.js shows "Gagal bikin tagihan: ..." and
-- payment-qr.js turns that into the manual QRIS popup.

begin;

create table if not exists public.payment_code_slots (
  code smallint primary key check (code between 1 and 999),
  payment_id uuid not null unique references public.payment_requests(id) on delete cascade deferrable initially deferred,
  expires_at timestamptz not null
);

-- Only the security-definer triggers below touch it; no policies = no client access.
alter table public.payment_code_slots enable row level security;

create or replace function public.assign_payment_unique_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code smallint;
begin
  -- Only the Saweria flow (payment-saweria.js always sends base_amount); anything else untouched.
  if new.base_amount is null and new.unique_code is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('payment_code_slots'));

  update public.payment_requests
  set status = 'expired'
  where status = 'pending' and unique_code is not null and expires_at < now();

  delete from public.payment_code_slots s
  where s.expires_at < now()
     or not exists (select 1 from public.payment_requests p where p.id = s.payment_id and p.status = 'pending');

  select g::smallint into v_code
  from generate_series(1, 999) g
  where not exists (select 1 from public.payment_code_slots s where s.code = g)
  order by g
  limit 1;

  if v_code is null then
    raise exception 'Semua kode unik lagi kepake, coba lagi beberapa menit lagi';
  end if;

  new.months := greatest(1, least(120, coalesce(new.months, 1)));
  new.base_amount := public.elite_price_per_month() * new.months;
  new.unique_code := v_code;
  new.amount := new.base_amount + v_code;
  new.expires_at := now() + interval '15 minutes';

  insert into public.payment_code_slots (code, payment_id, expires_at)
  values (v_code, new.id, new.expires_at);

  return new;
end;
$$;

drop trigger if exists payment_requests_assign_code on public.payment_requests;
create trigger payment_requests_assign_code
  before insert on public.payment_requests
  for each row execute function public.assign_payment_unique_code();

create or replace function public.release_payment_unique_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    delete from public.payment_code_slots where payment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_requests_release_code on public.payment_requests;
create trigger payment_requests_release_code
  after update of status on public.payment_requests
  for each row execute function public.release_payment_unique_code();

-- Codes still held by live pending rows from the old random flow.
insert into public.payment_code_slots (code, payment_id, expires_at)
select distinct on (unique_code) unique_code, id, expires_at
from public.payment_requests
where status = 'pending' and unique_code between 1 and 999 and expires_at > now()
order by unique_code, created_at
on conflict do nothing;

insert into public._migrations (filename) values ('0049_payment_code_slots.sql')
  on conflict (filename) do nothing;

commit;
