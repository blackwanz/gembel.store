-- 0023_payment_confirm_grants_elite.sql
-- The actual missing link behind "kok gak langsung Elite": nothing in the codebase ever set
-- profiles.plan/plan_until when a payment_requests row gets confirmed. Neither
-- services/saweria-listener nor admin.html's "Konfirmasi" button touch profiles at all -- both
-- only do update(payment_requests).set({status:'confirmed', paid_at: now()}). admin.html's own
-- confirm dialog literally promises "User langsung jadi Elite 30 hari", but there was never a
-- trigger (or any other code path) actually doing it.
--
-- Deeper than just a missing trigger, though: assets/auth.js's isElite(p) (verified live, since
-- the file is string-array-obfuscated and can't be read directly) checks `p.plan === 'elite'` --
-- but profiles' existing check constraint (user_profiles_plan_check) only ever allowed 'free' |
-- 'pro' | 'enterprise'. 'elite' could never legally be written to that column at all, so isElite()
-- was structurally guaranteed to stay false forever no matter what confirmed a payment. This
-- widens the constraint to also allow 'elite' (kept 'pro'/'enterprise' too, in case anything else
-- still relies on them) and adds the trigger that actually sets it.
--
-- On payment_requests flipping to 'confirmed' (from any other status): set the paying user's
-- profiles.plan = 'elite' and extend plan_until by 30 days from whichever is later -- their
-- current plan_until (if still in the future) or now() -- so paying again before expiry stacks
-- time instead of wasting it.
--
-- Same trigger also credits db/migrations/0007_leaderboard.sql's monthly leaderboard: +1,000,000
-- points on the user's current-month row (created if it doesn't exist yet), one grant per
-- confirmed payment -- unlike plan_until this is fine to stack per row, since each confirmed
-- payment is a genuine separate purchase event worth its own points.

begin;

alter table public.profiles drop constraint if exists user_profiles_plan_check;
alter table public.profiles
  add constraint user_profiles_plan_check
  check (plan = any (array['free'::text, 'pro'::text, 'enterprise'::text, 'elite'::text]));

create or replace function public.handle_payment_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    update public.profiles
    set plan = 'elite',
        plan_until = greatest(coalesce(plan_until, now()), now()) + interval '30 days'
    where id = new.user_id;

    insert into public.leaderboard_points (user_id, period_month, points)
    values (new.user_id, date_trunc('month', now())::date, 1000000)
    on conflict (user_id, period_month)
      do update set points = public.leaderboard_points.points + 1000000, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_payment_confirmed on public.payment_requests;
create trigger on_payment_confirmed
  after update on public.payment_requests
  for each row execute function public.handle_payment_confirmed();

-- Backfill (profiles): every payment_requests row already sitting at 'confirmed' from before
-- this trigger existed never got its user upgraded -- grant 30 days from now, once per user (not
-- stacked per row, since we can't tell which of a user's confirmed rows might already have been
-- honored some other way in the past, e.g. a manual admin fix outside this codebase).
update public.profiles p
set plan = 'elite',
    plan_until = greatest(coalesce(p.plan_until, now()), now()) + interval '30 days'
from (
  select distinct user_id from public.payment_requests where status = 'confirmed'
) pr
where p.id = pr.user_id;

-- Backfill (leaderboard): unlike plan_until, points ARE stacked per row here -- one confirmed
-- payment is one purchase event, credited to the month it was actually paid in (paid_at, falling
-- back to created_at for any older confirmed row from before paid_at existed).
insert into public.leaderboard_points (user_id, period_month, points)
select user_id, date_trunc('month', coalesce(paid_at, created_at))::date, count(*) * 1000000
from public.payment_requests
where status = 'confirmed'
group by user_id, date_trunc('month', coalesce(paid_at, created_at))::date
on conflict (user_id, period_month)
  do update set points = public.leaderboard_points.points + excluded.points, updated_at = now();

insert into public._migrations (filename) values ('0023_payment_confirm_grants_elite.sql')
  on conflict (filename) do nothing;

commit;
