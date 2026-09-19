-- 0026_progbar_realtime.sql
-- progbar.html (Neon Flow) now subscribes to postgres_changes UPDATE/INSERT events on
-- user_progbar_data so an idle device reflects another device's running session live instead of
-- only at boot -- but same issue already hit once for payment_requests (see
-- 0022_payment_requests_realtime.sql): the table was never added to the supabase_realtime
-- publication, so no change event would ever actually leave the database for a client to hear,
-- and the subscription would silently never fire.

begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_progbar_data'
  ) then
    alter publication supabase_realtime add table public.user_progbar_data;
  end if;
end $$;

insert into public._migrations (filename) values ('0026_progbar_realtime.sql')
  on conflict (filename) do nothing;

commit;
