-- 0013_profiles_auto_create.sql
-- public.profiles was another "pre-existing, out of scope" table
-- (0001_init.sql) assumed to already be fully wired up outside git. It
-- wasn't: there was never a trigger creating a profiles row when a new
-- auth.users row appears, and index.html's signup flow only calls
-- auth.signUp() (with full_name passed as user metadata) -- it never
-- inserts into public.profiles itself. Net effect: profiles has been
-- empty since day one, for every account, not just one user. This is
-- also why "login works but everything looks slightly off" -- every
-- requireAuth() call falls back to profile: null, and every page that
-- reads CURRENT_PROFILE degrades silently (name -> email fallback, role
-- check -> "not admin", isElite() -> false).
--
-- full_name is seeded from raw_user_meta_data, matching how index.html's
-- handleSignup() already passes `options: { data: { full_name: name } }`
-- to auth.signUp().

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill every existing auth.users row that doesn't have a profile yet
-- (this covers every account created before this migration, including
-- puts.company@gmail.com and any other existing signups).
insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data->>'full_name'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

insert into public._migrations (filename) values ('0013_profiles_auto_create.sql')
  on conflict (filename) do nothing;

commit;
