-- 0047_payment_months_and_prize_income.sql
-- Two things:
--
-- 1. Multi-month Elite payments. The payment modal (assets/payment-saweria.js) now lets a member
--    pay for any number of months at once instead of always exactly one. payment_requests gets a
--    `months` column, and handle_payment_confirmed() (from 0023) grants 30 days + 1,000,000
--    leaderboard points PER month instead of once per row.
--
--    `months` is written by the client, so it is never trusted on its own: the trigger caps it at
--    how many whole months the row's `amount` actually covers (amount is what the Saweria
--    listener matched against a real donation, or what an admin looked at before confirming).
--    Someone inserting months=12 with a one-month amount still only gets one month. Old
--    single-month rows (19.999 flow, months defaulting to 1) keep working unchanged -- the
--    greatest(1, ...) floor means a row is always worth at least one month, same as before.
--
-- 2. tournament_payment_income(start, end): the live prize pool on tournament.html is built from
--    every confirmed payment inside the tournament's period. payment_requests is RLS-restricted to
--    your own rows, so a normal player can't sum it themselves; this SECURITY DEFINER function
--    returns only the aggregate (total rupiah, number of payments, months sold) -- never who paid
--    what. Dates are Asia/Jakarta calendar days, end date inclusive.

begin;

alter table public.payment_requests
  add column if not exists months integer not null default 1;

alter table public.payment_requests drop constraint if exists payment_requests_months_check;
alter table public.payment_requests
  add constraint payment_requests_months_check check (months between 1 and 120);

-- Must match SITE_CONFIG.elitePricePerMonth in assets/site-config.js.
create or replace function public.elite_price_per_month()
returns numeric
language sql
immutable
as $$ select 29999::numeric $$;

create or replace function public.handle_payment_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_months integer;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    v_months := greatest(1, least(
      coalesce(new.months, 1),
      floor(coalesce(new.amount, 0) / public.elite_price_per_month())::integer
    ));

    update public.profiles
    set plan = 'elite',
        plan_until = greatest(coalesce(plan_until, now()), now()) + (interval '30 days' * v_months)
    where id = new.user_id;

    insert into public.leaderboard_points (user_id, period_month, points)
    values (new.user_id, date_trunc('month', now())::date, 1000000 * v_months)
    on conflict (user_id, period_month)
      do update set points = public.leaderboard_points.points + 1000000 * v_months, updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.tournament_payment_income(p_start date, p_end date)
returns table (total numeric, payments integer, months integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Harus login.';
  end if;
  return query
    select coalesce(sum(pr.amount), 0)::numeric,
           count(*)::integer,
           coalesce(sum(pr.months), 0)::integer
    from public.payment_requests pr
    where pr.status = 'confirmed'
      and coalesce(pr.paid_at, pr.created_at) >= (p_start::timestamp at time zone 'Asia/Jakarta')
      and coalesce(pr.paid_at, pr.created_at) <  ((p_end + 1)::timestamp at time zone 'Asia/Jakarta');
end;
$$;

grant execute on function public.tournament_payment_income(date, date) to authenticated;

insert into public._migrations (filename) values ('0047_payment_months_and_prize_income.sql')
  on conflict (filename) do nothing;

commit;
