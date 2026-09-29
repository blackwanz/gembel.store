-- check_elite.sql
-- Who is Elite and until when, with email. plan_until is the single source of truth: every
-- confirmed payment adds 30 days x months on top of it (see 0047/0048).
--
-- 1. All Elite members, soonest to expire first:
select p.email,
       p.full_name,
       p.plan,
       p.plan_until at time zone 'Asia/Jakarta'                         as habis_wib,
       greatest(0, ceil(extract(epoch from p.plan_until - now()) / 86400))::int as sisa_hari,
       p.plan_until < now()                                              as sudah_habis
from public.profiles p
where p.plan = 'elite'
order by p.plan_until nulls last;

-- 2. Only the ones already expired (these are what expire_elite_members() will flip to free):
-- select p.email, p.plan_until at time zone 'Asia/Jakarta' as habis_wib
-- from public.profiles p
-- where p.plan = 'elite' and p.plan_until < now();

-- 3. Flip the expired ones to free (returns how many changed):
-- select public.expire_elite_members();
