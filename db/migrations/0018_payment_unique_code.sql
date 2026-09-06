-- 0018_payment_unique_code.sql
-- Backs the Saweria auto-confirm flow (services/saweria-listener): since Saweria's donation
-- webhook only reports an amount, not which user paid, the client now appends a random 0-999
-- "unique code" to the tier's real price (assets/payment-saweria.js does this by patching
-- supabase.from('payment_requests').insert(...) from the outside, same technique payment-qr.js
-- already uses on window.alert -- auth.js is string-array-obfuscated, not just minified, so it
-- can't be hand-edited safely). The listener then matches an incoming donation's exact amount
-- back to the one pending row that has it.
--
-- base_amount:  the tier's real price (e.g. 19999), kept for display ("Rp 19.999 + kode unik").
-- amount:       base_amount + unique_code -- this is what the user actually has to transfer,
--               and what the listener matches Saweria donation amounts against.
-- unique_code:  the 0-999 suffix, stored separately so it doesn't have to be re-derived.
-- expires_at:   pending rows past this are stale; the listener flips them to 'expired' so their
--               amount can be reused by a later request without colliding.
-- paid_at:      when a donation matched and status flipped to 'confirmed' (null for the existing
--               manual-admin-confirm path, same as it is today).
--
-- The partial unique index enforces "at most one pending request per exact amount" at the DB
-- level (insert races between two users both retry with a new random code -- see
-- payment-saweria.js -- rather than the listener ever having to guess between two matches).
-- Scoped to unique_code is not null: prod already has multiple pre-existing pending rows all at
-- the flat 19999 (the old, code-less flow) -- a plain index on (amount) where status='pending'
-- fails to even create against that real data (23505 duplicate key on 19999). Every row the new
-- flow inserts always carries a unique_code, so this still gives the new flow the guarantee it
-- needs without touching old rows.

begin;

alter table public.payment_requests
  add column if not exists base_amount numeric,
  add column if not exists unique_code smallint,
  add column if not exists expires_at timestamptz,
  add column if not exists paid_at timestamptz;

alter table public.payment_requests drop constraint if exists payment_requests_status_check;
alter table public.payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'expired'));

create unique index if not exists payment_requests_pending_amount_idx
  on public.payment_requests(amount)
  where status = 'pending' and unique_code is not null;

insert into public._migrations (filename) values ('0018_payment_unique_code.sql')
  on conflict (filename) do nothing;

commit;
