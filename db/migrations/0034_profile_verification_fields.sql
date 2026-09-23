-- 0034_profile_verification_fields.sql
-- Rally Bracket's team-registration "Verifikasi Tambahan" (dob/email/payment) has always been
-- fake -- runVerification() just spun a timer and always resolved true, and none of the 5
-- checks were ever enforced before letting a team register. Fixing that for real means the
-- checks need to read genuine account data instead of scratch inputs re-typed every time
-- someone registers a team, so this adds the two profile fields that were missing for that:
--   dob        -- profiles never had a birth date column at all.
--   bank_name  -- profiles had wallet_type/wallet_number (GoPay or BTC address, one field) but
--                 nothing to hold a bank name separately from an account number.
--
-- wallet_type/wallet_number themselves need no schema change -- there was never a DB-level CHECK
-- on wallet_type (grepped every migration, confirmed none exists), so the app is free to widen
-- its allowed values (nothing/gopay/dana/linkaja/bank, dropping btc from the UI) without an
-- ALTER here. Existing 'btc' rows are left as-is; they just won't be selectable from the new
-- dropdown going forward. When wallet_type='bank', wallet_number holds the account number and
-- the new bank_name holds the bank; for the e-wallet methods, wallet_number holds the phone
-- number and bank_name stays null.
--
-- Also: dashboard.html's "Email" field has always been read-only (display only, from the auth
-- session) -- there was no auth.updateUser({email}) call anywhere in the codebase. Adding a real
-- "Ganti Email" flow there means a user's login email can change out from under
-- public.profiles.email (which was only ever seeded once, at signup, by
-- 0013_profiles_auto_create.sql's handle_new_user trigger). Nothing kept it in sync afterward.
-- profiles.email feeds the leaderboard name fallback (dashboard.html) and the archery-gift
-- sender name (0031_archery_gifts.sql), so add the missing counterpart trigger: whenever
-- auth.users.email actually changes (i.e. after Supabase's own confirmation flow completes),
-- mirror it into profiles.email.

begin;

alter table public.profiles add column if not exists dob date;
alter table public.profiles add column if not exists bank_name text;

create or replace function public.handle_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.handle_auth_email_change();

insert into public._migrations (filename) values ('0034_profile_verification_fields.sql')
  on conflict (filename) do nothing;

commit;
