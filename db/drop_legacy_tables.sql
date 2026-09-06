-- db/drop_legacy_tables.sql
-- Drops tables confirmed via db/check_unused_tables.sql to (a) exist,
-- (b) hold zero rows, and (c) have zero references anywhere in the
-- current codebase (checked against every `supabase.from(...)` call
-- across all *.html files and assets/*.js as of commit 930d521).
--
-- Dependency check (db/check_table_dependencies.sql) found exactly one
-- real blocker across all 12 tables: a leftover function `stop_habbit`
-- using habbit_d's row type. No current client code calls `.rpc(...)`
-- anywhere in the codebase, so it's dropped explicitly below rather than
-- reaching for CASCADE (which would silently take out anything else
-- unexpected too). Everything else pg_depend reported (constraints,
-- defaults, indexes, policies, realtime publication membership) belongs
-- to the tables themselves and is removed automatically by DROP TABLE.
--
-- NOT included: ketik_settings_ (confirmed via check_unused_tables.sql to
-- not exist at all -- nothing to drop).
--
-- DO NOT run this via db/migrate.sh -- it's a one-time manual cleanup, not
-- a schema migration, and migrate.sh has no per-statement confirmation.
-- Run it by hand.
--
-- Usage:
--   docker run --rm -i postgres:17 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/drop_legacy_tables.sql
-- or paste directly into Supabase SQL Editor.

begin;

drop function if exists public.stop_habbit(uuid, time without time zone, date, numeric, text);

-- IMPORTANT: this is "payment_request" (singular) -- the confirmed-obsolete
-- old schema (see assets/payment-qr.js's own comment). This is NOT the
-- same table as "payment_requests" (plural) -- that one is still actively
-- queried by admin.html, and per an earlier check, doesn't currently exist
-- in the database at all (a separate, live bug -- do not "fix" it by
-- creating it here without confirming the intended schema first).
drop table if exists public.payment_request;

drop table if exists public.apps;
drop table if exists public.calender_h;
drop table if exists public.calender_e;
drop table if exists public.progbar_c;
drop table if exists public.progbar_h;
drop table if exists public.progbar_h2;
drop table if exists public.habbit_h;
drop table if exists public.habbit_d;
drop table if exists public.meditate_h;
drop table if exists public.trade_master_c;
drop table if exists public.trade_master_h;

commit;
