-- 0050_kokoin.sql
-- Kokoin (kokoin.html): order matcha gummy, paid with merit poin, delivered to the member's home
-- address, with a live tracking timeline the admin updates by hand (no courier API yet).
--
--   * Merit poin live in an append-only ledger (merit_ledger). Balance = sum(delta). The admin
--     hands poin out (kokoin_grant, one member or everyone); an order debits them; a cancel refunds.
--   * The delivery address lives in its own owner-only table (profile_address), same reason KTP
--     does (0045): profiles rows are readable by every member, a home address must not be. The
--     admin can read it -- they're the one delivering.
--   * Orders and their tracking events are readable by the owner and the admin, and never written
--     directly: every change is a SECURITY DEFINER RPC below.
--
--   pending --(admin)--> processing --(admin)--> shipping --(admin)--> delivered
--     |                                                       (admin can move back/forth to fix
--   cancel(owner, only while pending) / cancel(admin, any time before delivered) -> cancelled,
--   poin refunded once.

begin;

create or replace function public.kokoin_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'); $$;

grant execute on function public.kokoin_is_admin() to authenticated;

-- One gummy = 500 ribu merit poin. Kept in one place so the page and the RPCs can't disagree.
create or replace function public.kokoin_price()
returns numeric
language sql
immutable
as $$ select 500000::numeric; $$;

grant execute on function public.kokoin_price() to authenticated;

-- ------------------------------------------------------------ address ----

create table if not exists public.profile_address (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recipient_name text not null check (length(btrim(recipient_name)) between 2 and 100),
  phone text not null check (length(btrim(phone)) between 6 and 20),
  address text not null check (length(btrim(address)) between 8 and 400),
  city text null check (city is null or length(city) <= 80),
  postal_code text null check (postal_code is null or length(postal_code) <= 10),
  notes text null check (notes is null or length(notes) <= 200),
  updated_at timestamptz not null default now()
);

alter table public.profile_address enable row level security;

drop policy if exists profile_address_select on public.profile_address;
create policy profile_address_select on public.profile_address
  for select to authenticated using (auth.uid() = user_id or public.kokoin_is_admin());
drop policy if exists profile_address_insert on public.profile_address;
create policy profile_address_insert on public.profile_address
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists profile_address_update on public.profile_address;
create policy profile_address_update on public.profile_address
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists profile_address_delete on public.profile_address;
create policy profile_address_delete on public.profile_address
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.profile_address from anon;
grant select, insert, update, delete on public.profile_address to authenticated;
grant all on public.profile_address to service_role;

-- ------------------------------------------------------------- ledger ----

create table if not exists public.merit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta numeric not null check (delta <> 0),
  reason text not null check (length(reason) <= 200),
  order_id uuid null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists merit_ledger_user_idx on public.merit_ledger(user_id, created_at desc);

alter table public.merit_ledger enable row level security;

drop policy if exists merit_ledger_select on public.merit_ledger;
create policy merit_ledger_select on public.merit_ledger
  for select to authenticated using (auth.uid() = user_id or public.kokoin_is_admin());

revoke all on public.merit_ledger from anon, authenticated;
grant select on public.merit_ledger to authenticated;
grant all on public.merit_ledger to service_role;

create or replace function public.merit_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$ select coalesce(sum(delta), 0) from public.merit_ledger where user_id = p_user; $$;

revoke all on function public.merit_balance(uuid) from public, anon, authenticated;

create or replace function public.kokoin_my_balance()
returns numeric
language sql
stable
security definer
set search_path = public
as $$ select public.merit_balance(auth.uid()); $$;

grant execute on function public.kokoin_my_balance() to authenticated;

-- ------------------------------------------------------------- orders ----

create table if not exists public.kokoin_orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  qty int not null check (qty between 1 and 50),
  unit_price numeric not null,
  total numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'shipping', 'delivered', 'cancelled')),
  -- Snapshot of the address at order time: changing the profile later must not re-route a gummy
  -- that's already on the road.
  ship_name text not null,
  ship_phone text not null,
  ship_address text not null,
  note text null check (note is null or length(note) <= 300),
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kokoin_orders_user_idx on public.kokoin_orders(user_id, created_at desc);
create index if not exists kokoin_orders_status_idx on public.kokoin_orders(status, created_at);

create table if not exists public.kokoin_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.kokoin_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,  -- order owner, for RLS/realtime
  status text not null,
  note text null check (note is null or length(note) <= 300),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists kokoin_events_order_idx on public.kokoin_events(order_id, created_at);

alter table public.kokoin_orders enable row level security;
alter table public.kokoin_events enable row level security;

drop policy if exists kokoin_orders_select on public.kokoin_orders;
create policy kokoin_orders_select on public.kokoin_orders
  for select to authenticated using (auth.uid() = user_id or public.kokoin_is_admin());
drop policy if exists kokoin_events_select on public.kokoin_events;
create policy kokoin_events_select on public.kokoin_events
  for select to authenticated using (auth.uid() = user_id or public.kokoin_is_admin());

revoke all on public.kokoin_orders, public.kokoin_events from anon, authenticated;
grant select on public.kokoin_orders, public.kokoin_events to authenticated;
grant all on public.kokoin_orders, public.kokoin_events to service_role;

-- ------------------------------------------------------------ helpers ----

create or replace function public.kokoin_notify(p_to uuid, p_title text, p_msg text, p_link text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_to is null then return; end if;
  insert into public.notifications (user_id, title, message, kind, link_url, created_by)
  values (p_to, p_title, p_msg, 'kokoin', p_link, auth.uid());
exception when others then
  null;  -- a notification failing must never block the order itself
end;
$$;

create or replace function public.kokoin_notify_admins(p_title text, p_msg text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a uuid;
begin
  for a in select id from public.profiles where role = 'admin' loop
    perform public.kokoin_notify(a, p_title, p_msg, 'kokoin.html#admin');
  end loop;
end;
$$;

create or replace function public.kokoin_pts(p numeric)
returns text
language sql
immutable
as $$ select replace(to_char(p, 'FM999G999G999G990'), ',', '.') || ' poin'; $$;

create or replace function public.kokoin_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'Member') from public.profiles where id = p_user; $$;

revoke all on function public.kokoin_notify(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.kokoin_notify_admins(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------ member RPCs ----

create or replace function public.kokoin_order(p_qty int, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a public.profile_address;
  v_total numeric;
  v_bal numeric;
  v_id uuid;
  v_no bigint;
begin
  if v_uid is null then raise exception 'Login dulu'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then raise exception 'Jumlah harus 1-50 biji'; end if;
  -- One order at a time per member, so two taps can't both pass the balance check.
  perform pg_advisory_xact_lock(hashtext('kokoin:' || v_uid::text));
  select * into a from public.profile_address where user_id = v_uid;
  if a.user_id is null then raise exception 'Isi alamat pengiriman dulu (di Profil / di Kokoin)'; end if;
  v_total := p_qty * public.kokoin_price();
  v_bal := public.merit_balance(v_uid);
  if v_bal < v_total then
    raise exception 'Poin lo kurang: butuh %, saldo %', public.kokoin_pts(v_total), public.kokoin_pts(v_bal);
  end if;
  insert into public.kokoin_orders (user_id, qty, unit_price, total, ship_name, ship_phone, ship_address, note)
  values (v_uid, p_qty, public.kokoin_price(), v_total, a.recipient_name, a.phone,
          concat_ws(', ', a.address, nullif(a.city, ''), nullif(a.postal_code, '')) ||
            case when a.notes is not null and a.notes <> '' then ' (' || a.notes || ')' else '' end,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id, order_no into v_id, v_no;
  insert into public.merit_ledger (user_id, delta, reason, order_id, created_by)
  values (v_uid, -v_total, 'Order #' || v_no || ' — ' || p_qty || ' matcha gummy', v_id, v_uid);
  insert into public.kokoin_events (order_id, user_id, status, note, created_by)
  values (v_id, v_uid, 'pending', 'Pesanan masuk, nunggu diproses', v_uid);
  perform public.kokoin_notify_admins('🍬 Order Kokoin baru',
    public.kokoin_name(v_uid) || ' pesen ' || p_qty || ' matcha gummy (#' || v_no || ') — kirim ke ' || a.recipient_name || '.');
  return v_id;
end;
$$;

grant execute on function public.kokoin_order(int, text) to authenticated;

-- Refund + cancelled event, shared by the member's and the admin's cancel.
create or replace function public.kokoin_do_cancel(o public.kokoin_orders, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kokoin_orders set status = 'cancelled', refunded = true, updated_at = now() where id = o.id;
  if not o.refunded then
    insert into public.merit_ledger (user_id, delta, reason, order_id, created_by)
    values (o.user_id, o.total, 'Refund order #' || o.order_no, o.id, auth.uid());
  end if;
  insert into public.kokoin_events (order_id, user_id, status, note, created_by)
  values (o.id, o.user_id, 'cancelled', coalesce(nullif(btrim(p_note), ''), 'Dibatalin, poin dibalikin'), auth.uid());
end;
$$;

revoke all on function public.kokoin_do_cancel(public.kokoin_orders, text) from public, anon, authenticated;

create or replace function public.kokoin_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare o public.kokoin_orders;
begin
  select * into o from public.kokoin_orders where id = p_id for update;
  if o.id is null or o.user_id <> auth.uid() then raise exception 'Order gak ketemu'; end if;
  if o.status <> 'pending' then raise exception 'Udah diproses admin, gak bisa dibatalin sendiri. Chat admin ya.'; end if;
  perform public.kokoin_do_cancel(o, 'Dibatalin sama lo, poin dibalikin');
  perform public.kokoin_notify_admins('↩️ Order Kokoin dibatalin',
    public.kokoin_name(o.user_id) || ' batalin order #' || o.order_no || '.');
end;
$$;

grant execute on function public.kokoin_cancel(uuid) to authenticated;

-- ------------------------------------------------------------- admin RPCs ----

-- Move an order to a status (or re-send the same status with a note, e.g. "kurir udah di gang").
create or replace function public.kokoin_set_status(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.kokoin_orders;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_title text; v_msg text;
begin
  if not public.kokoin_is_admin() then raise exception 'Cuma admin'; end if;
  if p_status not in ('pending', 'processing', 'shipping', 'delivered', 'cancelled') then
    raise exception 'Status gak dikenal: %', p_status;
  end if;
  select * into o from public.kokoin_orders where id = p_id for update;
  if o.id is null then raise exception 'Order gak ketemu'; end if;
  if o.status = 'cancelled' then raise exception 'Order ini udah dibatalin (poin udah dibalikin)'; end if;
  if p_status = 'cancelled' then
    perform public.kokoin_do_cancel(o, coalesce(v_note, 'Dibatalin admin, poin dibalikin'));
  else
    if p_status = o.status and v_note is null then return; end if;
    update public.kokoin_orders set status = p_status, updated_at = now() where id = o.id;
    insert into public.kokoin_events (order_id, user_id, status, note, created_by)
    values (o.id, o.user_id, p_status, v_note, auth.uid());
  end if;
  v_title := case p_status
    when 'pending' then '📝 Order #' || o.order_no || ' diterima'
    when 'processing' then '🧪 Order #' || o.order_no || ' lagi diracik'
    when 'shipping' then '🛵 Order #' || o.order_no || ' lagi dianter!'
    when 'delivered' then '📦 Order #' || o.order_no || ' udah sampai'
    else '❌ Order #' || o.order_no || ' dibatalin' end;
  v_msg := coalesce(v_note, case p_status
    when 'processing' then 'Matcha gummy lo lagi disiapin.'
    when 'shipping' then 'Kurir udah jalan ke ' || o.ship_name || '. Siap-siap di rumah ya.'
    when 'delivered' then 'Selamat menikmati 🍵'
    when 'cancelled' then public.kokoin_pts(o.total) || ' udah balik ke saldo lo.'
    else 'Status diperbarui.' end);
  perform public.kokoin_notify(o.user_id, v_title, v_msg, 'kokoin.html#order-' || o.id);
end;
$$;

grant execute on function public.kokoin_set_status(uuid, text, text) to authenticated;

-- Hand out (or take back, with a negative amount) merit poin. p_user null = every member.
create or replace function public.kokoin_grant(p_user uuid, p_amount numeric, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), case when p_amount > 0 then 'Hadiah dari admin' else 'Koreksi admin' end);
  r record; n int := 0;
begin
  if not public.kokoin_is_admin() then raise exception 'Cuma admin'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Jumlah poin gak boleh 0'; end if;
  for r in select id from public.profiles where p_user is null or id = p_user loop
    insert into public.merit_ledger (user_id, delta, reason, created_by) values (r.id, p_amount, v_reason, auth.uid());
    if p_amount > 0 then
      perform public.kokoin_notify(r.id, '🎁 Dapet ' || public.kokoin_pts(p_amount),
        v_reason || '. Tuker jadi matcha gummy di Kokoin!', 'kokoin.html');
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Member gak ketemu'; end if;
  return n;
end;
$$;

grant execute on function public.kokoin_grant(uuid, numeric, text) to authenticated;

-- Every member with their name and balance, for the admin's poin table.
create or replace function public.kokoin_balances()
returns table (user_id uuid, name text, email text, balance numeric, spent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.kokoin_is_admin() then raise exception 'Cuma admin'; end if;
  return query
    select p.id, public.kokoin_name(p.id), p.email::text,
           coalesce(sum(l.delta), 0),
           coalesce(-sum(l.delta) filter (where l.order_id is not null), 0)
    from public.profiles p
    left join public.merit_ledger l on l.user_id = p.id
    group by p.id, p.email
    order by 4 desc, 2;
end;
$$;

grant execute on function public.kokoin_balances() to authenticated;

-- ------------------------------------------------------------ realtime ----

do $$
declare t text;
begin
  foreach t in array array['kokoin_orders', 'kokoin_events', 'merit_ledger'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

insert into public._migrations (filename) values ('0050_kokoin.sql')
  on conflict (filename) do nothing;

commit;
