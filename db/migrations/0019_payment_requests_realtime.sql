-- 0019_payment_requests_realtime.sql
-- assets/payment-saweria.js subscribes to postgres_changes UPDATE events on payment_requests so
-- the payment modal reacts the instant services/saweria-listener (or an admin) confirms a row --
-- but the table was never added to the supabase_realtime publication, so Postgres's logical
-- replication never streamed those changes out and the subscription silently never fired.
-- Confirmed happening for real: the listener logged a successful confirm (status went to
-- 'confirmed', paid_at set) while the open payment modal sat on "Pembayaran sedang diproses..."
-- forever, because no change event ever left the database for any client to hear.

begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_requests'
  ) then
    alter publication supabase_realtime add table public.payment_requests;
  end if;
end $$;

insert into public._migrations (filename) values ('0019_payment_requests_realtime.sql')
  on conflict (filename) do nothing;

commit;
