-- db/check_unused_tables.sql
-- Non-destructive. Run this whole file in the Supabase SQL Editor (or via
-- psql) FIRST, before drop_legacy_tables.sql. Uses to_regclass so a table
-- that doesn't exist (or was typed slightly differently) just shows up as
-- exists_ = false in the results -- it does NOT abort the whole query the
-- way a plain `select count(*) from public.foo` would if "foo" is missing.
--
-- Covers two groups in one result:
--   1. Tables the current app code actively queries but that weren't in
--      the pasted "unused?" list -- sanity-check that they still exist
--      under these exact names.
--   2. Legacy-looking tables with zero references anywhere in the current
--      codebase -- confirms whether they're actually empty before anyone
--      drops them.
--
-- Usage: paste this whole file into Supabase SQL Editor and run it, or:
--   docker run --rm -i postgres:17 psql "$SUPABASE_DB_URL" -f db/check_unused_tables.sql

do $$
declare
  t text;
  cnt bigint;
  candidates text[] := array[
    -- should exist (queried by live code) -- sanity check only, not drop candidates
    'payment_requests', 'user_calendar_data', 'user_progbar_data',
    -- drop candidates -- zero references found anywhere in the current codebase
    'payment_request', 'apps', 'calender_h', 'calender_e',
    'progbar_c', 'progbar_h', 'progbar_h2', 'habbit_h', 'habbit_d',
    'meditate_h', 'trade_master_c', 'trade_master_h', 'ketik_settings_'
  ];
begin
  drop table if exists _table_audit;
  create temp table _table_audit (table_name text, exists_ boolean, row_count bigint);

  foreach t in array candidates loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into cnt;
      insert into _table_audit values (t, true, cnt);
    else
      insert into _table_audit values (t, false, null);
    end if;
  end loop;
end $$;

select table_name, exists_, row_count from _table_audit order by exists_ desc, table_name;
