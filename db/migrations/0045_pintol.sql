-- 0045_pintol.sql
-- Pintol.com (pintol.html): member-to-member loans that run on goodwill, not on collections.
-- Someone asks for up to Rp3 juta (total outstanding, not per request), another member lends it
-- by transferring straight to the borrower's rekening/e-wallet, and the borrower pays back when
-- they can -- with an optional, voluntary "bunga" on top. If they can't pay, the debt is simply
-- declared lunas (status 'forgiven') and the borrower shows up on the "Penerima Manfaat"
-- leaderboard instead. No money moves through the app; it only keeps the record straight.
--
-- Before anyone gets in (borrow OR lend), three things must be filled -- enforced here in
-- pintol_missing(), not just by the page:
--   wallet -- profiles.wallet_type/wallet_number (the account money gets sent to)
--   ktp    -- a valid NIK in the new profile_ktp table (below)
--   job    -- employer + salary for the CURRENT month (pintol_jobs), re-entered every month
--
-- KTP lives in its own owner-only table instead of new profiles columns on purpose: the
-- profiles_select policy is `using (true)`, i.e. every profile row is readable by everyone, and a
-- NIK must not be. Other members only ever get "KTP terverifikasi: ya/tidak" via pintol_people().
--
-- Loan rows are readable by every signed-in member (that's the "list yang available" board and
-- the leaderboard), but there are no insert/update/delete policies: every state change goes
-- through a SECURITY DEFINER function that checks who is calling and which state it's in.
--
--   open --commit(lender)--> funding --received(borrower)--> active --paid(borrower)--> paying
--     |                        |                               |                          |
--   cancel(borrower)      release(either) -> open          forgive(either)        repaid(lender)
--     v                                                        v                  not_received(lender) -> active
--   cancelled                                              forgiven               forgive(either) -> forgiven

begin;

-- ---------------------------------------------------------------- KTP ----

-- NIK layout: PP KK CC DDMMYY NNNN (province, regency, district, birth date with +40 on the day
-- for women, serial). Returns the reason it's invalid, or the parsed birth date / gender.
create or replace function public.ktp_parse_nik(p_nik text)
returns table (ok boolean, reason text, dob date, gender text, province_code text)
language plpgsql
stable
as $$
declare
  v_day int; v_month int; v_yy int; v_year int; v_dob date; v_gender text := 'L';
  v_cur_yy int := extract(year from current_date)::int % 100;
begin
  if p_nik is null or p_nik !~ '^[0-9]{16}$' then
    return query select false, 'NIK harus 16 digit angka', null::date, null::text, null::text; return;
  end if;
  if substr(p_nik, 1, 2) not in ('11','12','13','14','15','16','17','18','19','21','31','32','33','34','35','36',
      '51','52','53','61','62','63','64','65','71','72','73','74','75','76','81','82','91','92','93','94','95','96') then
    return query select false, 'Kode provinsi di NIK (2 digit pertama) gak valid', null::date, null::text, null::text; return;
  end if;
  if substr(p_nik, 3, 2) = '00' or substr(p_nik, 5, 2) = '00' then
    return query select false, 'Kode kabupaten/kecamatan di NIK gak valid', null::date, null::text, null::text; return;
  end if;
  if substr(p_nik, 13, 4) = '0000' then
    return query select false, 'Nomor urut di NIK (4 digit terakhir) gak boleh 0000', null::date, null::text, null::text; return;
  end if;
  v_day := substr(p_nik, 7, 2)::int;
  v_month := substr(p_nik, 9, 2)::int;
  v_yy := substr(p_nik, 11, 2)::int;
  if v_day > 40 then v_day := v_day - 40; v_gender := 'P'; end if;
  v_year := case when v_yy > v_cur_yy then 1900 + v_yy else 2000 + v_yy end;
  begin
    v_dob := make_date(v_year, v_month, v_day);
  exception when others then
    return query select false, 'Tanggal lahir di NIK (digit 7-12) gak valid', null::date, null::text, null::text; return;
  end;
  if v_dob > current_date - interval '17 years' then
    return query select false, 'Menurut NIK umur lo belum 17 tahun', v_dob, v_gender, substr(p_nik, 1, 2); return;
  end if;
  return query select true, null::text, v_dob, v_gender, substr(p_nik, 1, 2);
end;
$$;

grant execute on function public.ktp_parse_nik(text) to authenticated;

create table if not exists public.profile_ktp (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nik text not null unique check (nik ~ '^[0-9]{16}$'),
  ktp_name text not null check (length(btrim(ktp_name)) between 3 and 100),
  birth_place text null check (birth_place is null or length(birth_place) <= 80),
  dob date not null,
  gender text not null check (gender in ('L', 'P')),
  province_code text not null,
  verified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_ktp enable row level security;

drop policy if exists profile_ktp_select on public.profile_ktp;
create policy profile_ktp_select on public.profile_ktp
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists profile_ktp_insert on public.profile_ktp;
create policy profile_ktp_insert on public.profile_ktp
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists profile_ktp_update on public.profile_ktp;
create policy profile_ktp_update on public.profile_ktp
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists profile_ktp_delete on public.profile_ktp;
create policy profile_ktp_delete on public.profile_ktp
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.profile_ktp from anon;
grant select, insert, update, delete on public.profile_ktp to authenticated;
grant all on public.profile_ktp to service_role;

-- Changing the profile birth date afterwards would silently break the match above, so the KTP
-- flips to unverified until it's re-saved.
create or replace function public.profile_ktp_dob_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- depth > 1: this dob change came from profile_ktp_validate copying the NIK's date over, and
  -- touching that same profile_ktp row again mid-write would fail.
  if pg_trigger_depth() = 1 and new.dob is distinct from old.dob then
    update public.profile_ktp set verified = coalesce(dob = new.dob, false)
      where user_id = new.id and verified <> coalesce(dob = new.dob, false);
  end if;
  return new;
end;
$$;

-- Validation runs on every write regardless of what the page checked: the NIK must parse, must
-- not already belong to another account (friendlier message than the unique violation, and the
-- check needs SECURITY DEFINER to see other people's rows), and its birth date must match the
-- profile's -- if the profile has no birth date yet, the NIK's one is copied there.
-- An update that leaves NIK/name/place alone (profile_ktp_dob_changed flipping `verified`)
-- skips all that, otherwise it would force verified straight back to true.
create or replace function public.profile_ktp_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record; v_profile_dob date;
begin
  if tg_op = 'UPDATE' and new.nik = old.nik and new.ktp_name = old.ktp_name
     and new.birth_place is not distinct from old.birth_place then
    new.updated_at := now();
    return new;
  end if;
  new.nik := regexp_replace(coalesce(new.nik, ''), '[^0-9]', '', 'g');
  new.ktp_name := upper(btrim(regexp_replace(coalesce(new.ktp_name, ''), '\s+', ' ', 'g')));
  new.birth_place := nullif(upper(btrim(coalesce(new.birth_place, ''))), '');
  select * into p from public.ktp_parse_nik(new.nik);
  if not p.ok then raise exception '%', p.reason; end if;
  if exists (select 1 from public.profile_ktp k where k.nik = new.nik and k.user_id <> new.user_id) then
    raise exception 'NIK ini udah dipake akun lain';
  end if;
  select dob into v_profile_dob from public.profiles where id = new.user_id;
  if v_profile_dob is not null and v_profile_dob <> p.dob then
    raise exception 'Tanggal lahir di NIK (%) beda sama tanggal lahir di profil (%)',
      to_char(p.dob, 'DD-MM-YYYY'), to_char(v_profile_dob, 'DD-MM-YYYY');
  end if;
  if v_profile_dob is null then
    update public.profiles set dob = p.dob where id = new.user_id;
  end if;
  new.dob := p.dob;
  new.gender := p.gender;
  new.province_code := p.province_code;
  new.verified := true;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profile_ktp_validate_trg on public.profile_ktp;
create trigger profile_ktp_validate_trg
  before insert or update on public.profile_ktp
  for each row execute function public.profile_ktp_validate();

drop trigger if exists profile_ktp_dob_changed_trg on public.profiles;
create trigger profile_ktp_dob_changed_trg
  after update of dob on public.profiles
  for each row execute function public.profile_ktp_dob_changed();

-- ---------------------------------------------------------- jobs / gaji ----

create or replace function public.pintol_month()
returns date
language sql
stable
as $$ select date_trunc('month', now() at time zone 'Asia/Jakarta')::date; $$;

create table if not exists public.pintol_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  employer text not null check (length(btrim(employer)) between 2 and 120),
  job_title text null check (job_title is null or length(job_title) <= 120),
  salary numeric not null check (salary >= 0 and salary <= 10000000000),
  note text null check (note is null or length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.pintol_jobs enable row level security;

drop policy if exists pintol_jobs_own on public.pintol_jobs;
create policy pintol_jobs_own on public.pintol_jobs
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.pintol_jobs from anon;
grant select, insert, update, delete on public.pintol_jobs to authenticated;
grant all on public.pintol_jobs to service_role;

-- ---------------------------------------------------------------- loans ----

create table if not exists public.pintol_loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references auth.users(id) on delete cascade,
  lender_id uuid null references auth.users(id) on delete set null,
  amount numeric not null check (amount >= 10000 and amount <= 3000000),
  purpose text not null check (length(btrim(purpose)) between 3 and 300),
  offered_interest numeric not null default 0 check (offered_interest >= 0 and offered_interest <= 3000000),
  interest_paid numeric not null default 0 check (interest_paid >= 0 and interest_paid <= 3000000),
  due_date date not null,
  status text not null default 'open'
    check (status in ('open', 'funding', 'active', 'paying', 'repaid', 'forgiven', 'cancelled')),
  committed_at timestamptz null,   -- lender said "gw yang pinjemin"
  funded_at timestamptz null,      -- borrower confirmed the money arrived
  paid_at timestamptz null,        -- borrower said they paid back
  settled_at timestamptz null,     -- repaid / forgiven / cancelled
  forgiven_by uuid null references auth.users(id) on delete set null,
  forgive_note text null check (forgive_note is null or length(forgive_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pintol_loans_status_idx on public.pintol_loans(status, created_at desc);
create index if not exists pintol_loans_borrower_idx on public.pintol_loans(borrower_id);
create index if not exists pintol_loans_lender_idx on public.pintol_loans(lender_id);

alter table public.pintol_loans enable row level security;

drop policy if exists pintol_loans_select on public.pintol_loans;
create policy pintol_loans_select on public.pintol_loans
  for select to authenticated using (true);

revoke all on public.pintol_loans from anon, authenticated;
grant select on public.pintol_loans to authenticated;
grant all on public.pintol_loans to service_role;

-- ------------------------------------------------------------ helpers ----

-- What the user still has to fill before they may borrow or lend: any of 'wallet', 'ktp', 'job'.
create or replace function public.pintol_missing(p_uid uuid default null)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with u as (select coalesce(p_uid, auth.uid()) as id)
  select array_remove(array[
    case when exists (select 1 from public.profiles p, u where p.id = u.id
                        and coalesce(p.wallet_type, 'nothing') in ('gopay', 'dana', 'linkaja', 'bank')
                        and length(btrim(coalesce(p.wallet_number, ''))) >= 5
                        and (p.wallet_type <> 'bank' or length(btrim(coalesce(p.bank_name, ''))) >= 2))
         then null else 'wallet' end,
    case when exists (select 1 from public.profile_ktp k, u where k.user_id = u.id and k.verified)
         then null else 'ktp' end,
    case when exists (select 1 from public.pintol_jobs j, u where j.user_id = u.id and j.month = public.pintol_month())
         then null else 'job' end
  ], null);
$$;

grant execute on function public.pintol_missing(uuid) to authenticated;

create or replace function public.pintol_require_ready()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text[];
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  v := public.pintol_missing(auth.uid());
  if cardinality(v) > 0 then
    raise exception 'Lengkapi dulu: %', array_to_string(array(
      select case x when 'wallet' then 'rekening/e-wallet' when 'ktp' then 'KTP' else 'kerja & gaji bulan ini' end
      from unnest(v) x), ', ');
  end if;
end;
$$;

create or replace function public.pintol_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'Member')
  from public.profiles where id = p_uid;
$$;

create or replace function public.pintol_notify(p_to uuid, p_title text, p_msg text, p_loan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_to is null then return; end if;
  insert into public.notifications (user_id, title, message, kind, link_url, payload, created_by)
  values (p_to, p_title, p_msg, 'pintol', 'pintol.html#loan-' || p_loan, jsonb_build_object('loan_id', p_loan), auth.uid());
exception when others then
  null;  -- a notification failing must never block the loan itself
end;
$$;

create or replace function public.pintol_rp(p numeric)
returns text
language sql
stable
as $$ select 'Rp' || replace(to_char(p, 'FM999G999G999G990'), ',', '.'); $$;

-- The public card other members see about someone: name, where they work and what they earn
-- (this month's entry, or the latest one), whether their KTP checked out, and their track record.
-- Never the NIK, never the account number (that's pintol_payout, for the counterparty only).
create or replace function public.pintol_people(p_ids uuid[])
returns table (
  id uuid, name text, employer text, job_title text, salary numeric, job_month date,
  ktp_verified boolean, gender text, age int,
  borrowed_count int, repaid_count int, forgiven_count int, forgiven_total numeric,
  lent_count int, lent_total numeric, lent_forgiven_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    public.pintol_name(p.id),
    j.employer, j.job_title, j.salary, j.month,
    coalesce(k.verified, false), k.gender,
    case when k.dob is not null then extract(year from age(k.dob))::int end,
    (select count(*)::int from public.pintol_loans l where l.borrower_id = p.id and l.status in ('active','paying','repaid','forgiven')),
    (select count(*)::int from public.pintol_loans l where l.borrower_id = p.id and l.status = 'repaid'),
    (select count(*)::int from public.pintol_loans l where l.borrower_id = p.id and l.status = 'forgiven'),
    (select coalesce(sum(l.amount), 0) from public.pintol_loans l where l.borrower_id = p.id and l.status = 'forgiven'),
    (select count(*)::int from public.pintol_loans l where l.lender_id = p.id and l.status in ('active','paying','repaid','forgiven')),
    (select coalesce(sum(l.amount), 0) from public.pintol_loans l where l.lender_id = p.id and l.status in ('active','paying','repaid','forgiven')),
    (select coalesce(sum(l.amount), 0) from public.pintol_loans l where l.lender_id = p.id and l.status = 'forgiven')
  from public.profiles p
  left join public.profile_ktp k on k.user_id = p.id
  left join lateral (
    select * from public.pintol_jobs j where j.user_id = p.id order by j.month desc limit 1
  ) j on true
  where auth.uid() is not null and p.id = any(p_ids);
$$;

grant execute on function public.pintol_people(uuid[]) to authenticated;

-- Where to send money for this loan: the borrower's account to the lender (funding/active), the
-- lender's account to the borrower (active/paying, to pay back). Nobody else gets anything.
create or replace function public.pintol_payout(p_loan uuid)
returns table (name text, wallet_type text, bank_name text, wallet_number text, phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.pintol_loans; v_target uuid;
begin
  select * into l from public.pintol_loans where id = p_loan;
  if not found then raise exception 'Pinjaman gak ketemu'; end if;
  if auth.uid() = l.lender_id and l.status in ('funding', 'active', 'paying') then
    v_target := l.borrower_id;
  elsif auth.uid() = l.borrower_id and l.lender_id is not null and l.status in ('funding', 'active', 'paying') then
    v_target := l.lender_id;
  else
    raise exception 'Rekening cuma kelihatan buat peminjam & pemberi pinjaman ini';
  end if;
  return query
    select public.pintol_name(p.id), p.wallet_type, p.bank_name, p.wallet_number, p.phone
    from public.profiles p where p.id = v_target;
end;
$$;

grant execute on function public.pintol_payout(uuid) to authenticated;

-- ------------------------------------------------------------ actions ----

create or replace function public.pintol_request(p_amount numeric, p_purpose text, p_due date, p_interest numeric default 0)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_out numeric; v_id uuid; v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform public.pintol_require_ready();
  if p_amount is null or p_amount < 10000 then raise exception 'Minimal pinjam Rp10.000'; end if;
  if p_due is null or p_due <= v_today or p_due > v_today + 365 then
    raise exception 'Tanggal bayar harus antara besok sampai 1 tahun lagi';
  end if;
  -- Lock this borrower's rows so two quick requests can't both squeeze under the limit.
  perform 1 from public.pintol_loans where borrower_id = auth.uid() for update;
  select coalesce(sum(amount), 0) into v_out from public.pintol_loans
    where borrower_id = auth.uid() and status in ('open', 'funding', 'active', 'paying');
  if v_out + p_amount > 3000000 then
    raise exception 'Limit pinjaman Rp3.000.000. Yang lagi jalan: %, sisa limit: %',
      public.pintol_rp(v_out), public.pintol_rp(greatest(0, 3000000 - v_out));
  end if;
  insert into public.pintol_loans (borrower_id, amount, purpose, due_date, offered_interest)
  values (auth.uid(), round(p_amount), btrim(p_purpose), p_due, greatest(0, round(coalesce(p_interest, 0))))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.pintol_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pintol_loans set status = 'cancelled', settled_at = now(), updated_at = now()
  where id = p_id and borrower_id = auth.uid() and status = 'open';
  if not found then raise exception 'Cuma permintaan lo sendiri yang belum diambil yang bisa dibatalin'; end if;
end;
$$;

create or replace function public.pintol_commit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  perform public.pintol_require_ready();
  select * into l from public.pintol_loans where id = p_id for update;
  if not found then raise exception 'Pinjaman gak ketemu'; end if;
  if l.borrower_id = auth.uid() then raise exception 'Gak bisa minjemin ke diri sendiri'; end if;
  if l.status <> 'open' then raise exception 'Keburu diambil orang lain'; end if;
  update public.pintol_loans set status = 'funding', lender_id = auth.uid(), committed_at = now(), updated_at = now()
  where id = p_id;
  perform public.pintol_notify(l.borrower_id, '🤝 Ada yang mau minjemin',
    public.pintol_name(auth.uid()) || ' mau minjemin ' || public.pintol_rp(l.amount) ||
    '. Cek rekening lo, terus konfirmasi di Pintol kalau udah masuk.', p_id);
end;
$$;

create or replace function public.pintol_release(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  select * into l from public.pintol_loans where id = p_id for update;
  if not found or l.status <> 'funding' or auth.uid() not in (l.borrower_id, l.lender_id) then
    raise exception 'Cuma bisa dilepas selama uangnya belum dikonfirmasi masuk';
  end if;
  update public.pintol_loans set status = 'open', lender_id = null, committed_at = null, updated_at = now()
  where id = p_id;
  perform public.pintol_notify(case when auth.uid() = l.borrower_id then l.lender_id else l.borrower_id end,
    '↩️ Pinjaman dilepas', public.pintol_name(auth.uid()) || ' ngelepas pinjaman ' || public.pintol_rp(l.amount) ||
    ' — balik ke daftar yang available.', p_id);
end;
$$;

create or replace function public.pintol_received(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  update public.pintol_loans set status = 'active', funded_at = now(), updated_at = now()
  where id = p_id and borrower_id = auth.uid() and status = 'funding'
  returning * into l;
  if not found then raise exception 'Gak ada pinjaman yang lagi nunggu konfirmasi'; end if;
  perform public.pintol_notify(l.lender_id, '✅ Uang udah diterima',
    public.pintol_name(auth.uid()) || ' konfirmasi ' || public.pintol_rp(l.amount) || ' udah masuk. Makasih udah bantu!', p_id);
end;
$$;

create or replace function public.pintol_paid(p_id uuid, p_interest numeric default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  update public.pintol_loans
  set status = 'paying', paid_at = now(), interest_paid = greatest(0, round(coalesce(p_interest, 0))), updated_at = now()
  where id = p_id and borrower_id = auth.uid() and status = 'active'
  returning * into l;
  if not found then raise exception 'Gak ada pinjaman aktif buat dibayar'; end if;
  perform public.pintol_notify(l.lender_id, '💸 Katanya udah dibayar',
    public.pintol_name(auth.uid()) || ' bilang udah transfer ' || public.pintol_rp(l.amount + l.interest_paid) ||
    case when l.interest_paid > 0 then ' (termasuk bunga sukarela ' || public.pintol_rp(l.interest_paid) || ')' else '' end ||
    '. Cek rekening lo terus konfirmasi.', p_id);
end;
$$;

create or replace function public.pintol_repaid(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  update public.pintol_loans set status = 'repaid', settled_at = now(), updated_at = now()
  where id = p_id and lender_id = auth.uid() and status = 'paying'
  returning * into l;
  if not found then raise exception 'Gak ada pembayaran yang nunggu konfirmasi lo'; end if;
  perform public.pintol_notify(l.borrower_id, '🎉 Lunas!',
    public.pintol_name(auth.uid()) || ' konfirmasi pembayaran ' || public.pintol_rp(l.amount) || ' udah diterima. Lunas.', p_id);
end;
$$;

create or replace function public.pintol_not_received(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  update public.pintol_loans set status = 'active', paid_at = null, interest_paid = 0, updated_at = now()
  where id = p_id and lender_id = auth.uid() and status = 'paying'
  returning * into l;
  if not found then raise exception 'Gak ada pembayaran yang nunggu konfirmasi lo'; end if;
  perform public.pintol_notify(l.borrower_id, '⚠️ Pembayaran belum masuk',
    public.pintol_name(auth.uid()) || ' belum nerima pembayaran ' || public.pintol_rp(l.amount) || '. Cek lagi transfernya ya.', p_id);
end;
$$;

-- "Gak bisa bayar gpp": either side can close an active loan as lunas. The borrower lands on the
-- Penerima Manfaat leaderboard (computed from status='forgiven' rows).
create or replace function public.pintol_forgive(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.pintol_loans;
begin
  update public.pintol_loans
  set status = 'forgiven', settled_at = now(), forgiven_by = auth.uid(),
      forgive_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_id and auth.uid() in (borrower_id, lender_id) and status in ('active', 'paying')
  returning * into l;
  if not found then raise exception 'Cuma pinjaman yang lagi jalan yang bisa dianggap lunas'; end if;
  if auth.uid() = l.borrower_id then
    perform public.pintol_notify(l.lender_id, '🕊️ Pinjaman dianggap lunas',
      public.pintol_name(auth.uid()) || ' gak sanggup bayar ' || public.pintol_rp(l.amount) ||
      ' — dianggap lunas & jadi donasi lo. Makasih udah bantu.', p_id);
  else
    perform public.pintol_notify(l.borrower_id, '🕊️ Utang lo diikhlasin',
      public.pintol_name(auth.uid()) || ' ngikhlasin pinjaman ' || public.pintol_rp(l.amount) || '. Dianggap lunas.', p_id);
  end if;
end;
$$;

revoke execute on function public.pintol_require_ready() from public, anon, authenticated;
revoke execute on function public.pintol_notify(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.pintol_name(uuid) to authenticated;
grant execute on function public.pintol_request(numeric, text, date, numeric) to authenticated;
grant execute on function public.pintol_cancel(uuid) to authenticated;
grant execute on function public.pintol_commit(uuid) to authenticated;
grant execute on function public.pintol_release(uuid) to authenticated;
grant execute on function public.pintol_received(uuid) to authenticated;
grant execute on function public.pintol_paid(uuid, numeric) to authenticated;
grant execute on function public.pintol_repaid(uuid) to authenticated;
grant execute on function public.pintol_not_received(uuid) to authenticated;
grant execute on function public.pintol_forgive(uuid, text) to authenticated;

insert into public._migrations (filename) values ('0045_pintol.sql')
  on conflict (filename) do nothing;

commit;
