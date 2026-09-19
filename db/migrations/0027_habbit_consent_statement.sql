-- 0027_habbit_consent_statement.sql
-- habbit.html's expense "consent gate" statement (the sentence you have to retype before an
-- outgoing transaction saves) used to be one hardcoded sentence for every account. Per request:
-- a brand-new user should write their own version during first-time setup ("sign Y" on their own
-- wording), while every EXISTING user keeps behaving exactly as before -- so this backfills the
-- previous hardcoded sentence into every account that already has data, and only brand-new
-- accounts (no habbit_settings row, no habbit_entries) see the new setup flow.

begin;

alter table public.habbit_settings add column if not exists consent_statement text;

-- Grandfather every account that already has a habbit_settings row: fill in the sentence they've
-- always seen, unchanged, so nothing about their experience changes.
update public.habbit_settings
set consent_statement = 'Gw consent: budget ini gw pake secukupnya & berarti.' || chr(10) ||
  'Gw gak overspend, gak trading ugal-ugalan, gak foya-foya.'
where consent_statement is null;

-- Also grandfather any account that already has expense/activity history but, for whatever
-- reason, never got a habbit_settings row (e.g. never touched a target/budget field) -- they're
-- an existing user too, not a brand-new one, so they shouldn't see the first-time setup gate.
insert into public.habbit_settings (user_id, consent_statement)
select distinct e.user_id,
  'Gw consent: budget ini gw pake secukupnya & berarti.' || chr(10) ||
  'Gw gak overspend, gak trading ugal-ugalan, gak foya-foya.'
from public.habbit_entries e
left join public.habbit_settings s on s.user_id = e.user_id
where s.user_id is null
on conflict (user_id) do nothing;

insert into public._migrations (filename) values ('0027_habbit_consent_statement.sql')
  on conflict (filename) do nothing;

commit;
