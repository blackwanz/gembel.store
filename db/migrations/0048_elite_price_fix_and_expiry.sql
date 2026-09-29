-- 0048_elite_price_fix_and_expiry.sql
-- Two things:
--
-- 1. Price fix. 0047 set elite_price_per_month() to 29,999, but the real Elite price (what
--    auth.js's modal charges and what every payment_requests.base_amount so far says) is 19,999.
--    With 29,999 the month picker would have asked Rp 89.997 instead of Rp 59.997 for 3 months,
--    and the trigger's cap floor(amount / 29999) would have granted only 2 months for a correct
--    3 x 19,999 payment. Must match SITE_CONFIG.elitePricePerMonth in assets/site-config.js.
--
-- 2. expire_elite_members(): flips every profile whose plan_until has passed back to 'free' and
--    returns how many it changed. Stacking already works (handle_payment_confirmed() adds
--    30 days x months on top of whichever is later, the current plan_until or now()), so
--    plan_until is the single source of truth for "masih Elite atau enggak". Not scheduled here --
--    run it by hand, or daily via pg_cron:
--      select cron.schedule('expire-elite', '5 17 * * *', 'select public.expire_elite_members()');
--    (17:05 UTC = 00:05 WIB)

begin;

create or replace function public.elite_price_per_month()
returns numeric
language sql
immutable
as $$ select 19999::numeric $$;

create or replace function public.expire_elite_members()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.profiles
    set plan = 'free'
    where plan = 'elite'
      and plan_until < now()  -- null = no end date (manual grant), left alone
    returning 1
  )
  select count(*)::integer from expired;
$$;

revoke execute on function public.expire_elite_members() from public, anon, authenticated;

insert into public._migrations (filename) values ('0048_elite_price_fix_and_expiry.sql')
  on conflict (filename) do nothing;

commit;
