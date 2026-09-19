-- 0031_archery_gifts.sql
-- Lets a Stargazer Archery user "gift" their arrow setups to another member by email: the
-- recipient (if they're a real active user) gets a notification, and clicking it (or just
-- opening archery.html) asks them Y/N whether to add the N gifted arrows to their own data.
--
-- Two RPCs do all the real work server-side (SECURITY DEFINER), rather than opening up RLS
-- holes that would let any authenticated user insert arbitrary rows into someone else's
-- notifications or archery_data:
--   gift_archery_arrows(p_recipient_email)   -- sender side: look up recipient, snapshot the
--                                                sender's current arrows, create the gift +
--                                                notification
--   respond_archery_gift(p_gift_id, p_accept) -- recipient side: accept (merge into their own
--                                                 archery_data.arrows) or decline
-- A plain authenticated user has no direct SELECT on auth.users (email lookup) and no INSERT
-- into notifications for someone else -- both only happen inside these functions, which
-- themselves enforce that the caller is who they claim to be (auth.uid()) and that a gift can
-- only be responded to by its actual recipient while still pending.

begin;

-- ---- notifications: generalize beyond plain admin announcements ----
-- kind distinguishes an admin broadcast ('announcement', the existing default -- every row that
-- already exists is exactly this) from something actionable like an archery gift; link_url lets
-- dashboard.html navigate somewhere on click instead of being purely informational; payload
-- carries whatever small bit of structured data the click target needs (e.g. the gift id) without
-- a second round trip.
alter table public.notifications add column if not exists kind text not null default 'announcement';
alter table public.notifications add column if not exists link_url text null;
alter table public.notifications add column if not exists payload jsonb null;

create table if not exists public.archery_gifts (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  arrows jsonb not null,
  arrow_count integer not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz null
);

create index if not exists archery_gifts_to_user_pending_idx on public.archery_gifts(to_user_id) where status = 'pending';

alter table public.archery_gifts enable row level security;

-- Both sides of a gift can see it (sender: to track whether it was accepted; recipient: to
-- answer it) -- but only through the RPCs below can one ever be created or responded to; there
-- is deliberately no direct insert/update policy.
create policy archery_gifts_select on public.archery_gifts
  for select to authenticated
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

create or replace function public.gift_archery_arrows(p_recipient_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_id uuid;
  v_arrows jsonb;
  v_count integer;
  v_gift_id uuid;
  v_sender_name text;
begin
  select id into v_recipient_id from auth.users where lower(email) = lower(trim(p_recipient_email)) limit 1;
  if v_recipient_id is null then
    raise exception 'Gak ada user aktif dengan email itu.';
  end if;
  if v_recipient_id = auth.uid() then
    raise exception 'Gak bisa ngasih data ke diri sendiri.';
  end if;

  select arrows into v_arrows from public.archery_data where user_id = auth.uid();
  if v_arrows is null or jsonb_array_length(v_arrows) = 0 then
    raise exception 'Kamu belum punya data arrow buat dikasih.';
  end if;
  v_count := jsonb_array_length(v_arrows);

  insert into public.archery_gifts (from_user_id, to_user_id, arrows, arrow_count)
  values (auth.uid(), v_recipient_id, v_arrows, v_count)
  returning id into v_gift_id;

  select coalesce(full_name, email, 'Seseorang') into v_sender_name from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, title, message, kind, link_url, payload, created_by)
  values (
    v_recipient_id,
    '🎁 Kiriman data arrow',
    v_sender_name || ' ngasih ' || v_count || ' data arrow buat Stargazer Archery kamu. Klik buat lihat & terima.',
    'archery_gift',
    'archery.html',
    jsonb_build_object('gift_id', v_gift_id, 'arrow_count', v_count),
    auth.uid()
  );

  return v_gift_id;
end;
$$;

create or replace function public.respond_archery_gift(p_gift_id uuid, p_accept boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gift record;
  v_existing jsonb;
  v_merged jsonb;
begin
  select * into v_gift from public.archery_gifts where id = p_gift_id for update;
  if v_gift is null then raise exception 'Kiriman gak ketemu.'; end if;
  if v_gift.to_user_id <> auth.uid() then raise exception 'Kiriman ini bukan buat kamu.'; end if;
  if v_gift.status <> 'pending' then raise exception 'Kiriman ini udah dijawab sebelumnya.'; end if;

  if p_accept then
    select arrows into v_existing from public.archery_data where user_id = auth.uid();
    v_merged := coalesce(v_existing, '[]'::jsonb) || v_gift.arrows;
    insert into public.archery_data (user_id, arrows)
    values (auth.uid(), v_merged)
    on conflict (user_id) do update set arrows = v_merged, updated_at = now();
  end if;

  update public.archery_gifts
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
  where id = p_gift_id;

  return v_gift.arrow_count;
end;
$$;

-- dashboard.html has subscribed to postgres_changes on notifications since
-- 0017_notifications.sql shipped (channel 'own-notifications-<uid>'), but the table was never
-- added to the supabase_realtime publication -- same silent-no-op bug already hit for
-- payment_requests (0022) and user_progbar_data (0026). Fixed here since a gift notification
-- arriving instantly (not just on next page load) is the whole point of this feature.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

insert into public._migrations (filename) values ('0031_archery_gifts.sql')
  on conflict (filename) do nothing;

commit;
