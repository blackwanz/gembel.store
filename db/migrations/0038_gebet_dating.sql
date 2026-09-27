-- 0038_gebet_dating.sql
-- Backs Gebet (gebet.html), a small Tinder-style dating app:
--   * one profile per user: name, gender, who they're into, city, a free-text bio, and exactly
--     ONE photo that has to be re-uploaded at least every 30 days (older than that = the profile
--     drops out of everyone's swipe deck until a fresh one lands).
--   * swipe left (pass) / right (like); mutual likes are a match.
--   * "DM" = a comment on someone's photo. Only the photo owner and the comment's author can read
--     it (it's a DM, not a public comment thread), and the author's name links to their profile.
--   * every profile has a public link (gebet.html?u=<user_id>) that works without logging in.
--
-- Birth date is NOT duplicated here -- it reuses profiles.dob (0034_profile_verification_fields.sql),
-- the same field dashboard.html's Profil tab edits. gebet.html forces a popup to fill it in before
-- anything else. The raw date never leaves the server for other users: the deck / public-profile
-- RPCs below are SECURITY DEFINER and only return the derived age, since profiles itself isn't
-- readable by anon at all.
--
-- photo_uploaded_at is stamped by a trigger (not trusted from the client), so "the photo is recent"
-- is measured from when it actually reached us. gebet.html additionally refuses files whose
-- EXIF/lastModified date is older than 30 days, but that part is client-side only.

begin;

create table if not exists public.gebet_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  gender text not null check (gender in ('pria', 'wanita')),
  interested_in text not null check (interested_in in ('pria', 'wanita', 'semua')),
  city text null check (city is null or char_length(city) <= 60),
  bio text not null default '' check (char_length(bio) <= 1000),
  photo_path text null,
  photo_url text null,
  photo_uploaded_at timestamptz null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gebet_swipes (
  swiper_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  liked boolean not null,
  created_at timestamptz not null default now(),
  primary key (swiper_id, target_id),
  check (swiper_id <> target_id)
);
create index if not exists gebet_swipes_target_idx on public.gebet_swipes(target_id) where liked;

create table if not exists public.gebet_comments (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  check (target_id <> author_id)
);
create index if not exists gebet_comments_target_idx on public.gebet_comments(target_id, created_at desc);
create index if not exists gebet_comments_author_idx on public.gebet_comments(author_id, created_at desc);

alter table public.gebet_profiles enable row level security;
alter table public.gebet_swipes enable row level security;
alter table public.gebet_comments enable row level security;

-- ---------------------------------------------------------------- helpers

create or replace function public.gebet_age(_user_id uuid)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select date_part('year', age(current_date, dob))::int from public.profiles where id = _user_id;
$$;
grant execute on function public.gebet_age(uuid) to anon, authenticated;

-- "Ready" = allowed to appear in decks and to swipe/comment: 18+, active, non-empty bio, photo
-- uploaded within the last 30 days.
create or replace function public.gebet_is_ready(_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.gebet_profiles g
    where g.user_id = _user_id
      and g.is_active
      and char_length(trim(g.bio)) > 0
      and g.photo_url is not null
      and g.photo_uploaded_at > now() - interval '30 days'
      and coalesce(public.gebet_age(g.user_id), 0) >= 18
  );
$$;
grant execute on function public.gebet_is_ready(uuid) to authenticated;

-- Server owns photo_uploaded_at + updated_at, and refuses under-18 / missing-dob accounts.
create or replace function public.gebet_profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_age int;
begin
  v_age := public.gebet_age(new.user_id);
  if v_age is null then
    raise exception 'Isi tanggal lahir dulu.';
  end if;
  if v_age < 18 then
    raise exception 'Gebet cuma buat umur 18+.';
  end if;

  if tg_op = 'INSERT' then
    new.photo_uploaded_at := case when new.photo_path is null then null else now() end;
    new.created_at := now();
  elsif new.photo_path is distinct from old.photo_path then
    new.photo_uploaded_at := case when new.photo_path is null then null else now() end;
  else
    new.photo_uploaded_at := old.photo_uploaded_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gebet_profiles_before_write on public.gebet_profiles;
create trigger gebet_profiles_before_write
  before insert or update on public.gebet_profiles
  for each row execute function public.gebet_profiles_before_write();

-- ---------------------------------------------------------------- RLS

-- gebet_profiles holds nothing sensitive (no dob, no email), so any logged-in user may read any
-- row -- needed to show a commenter's name/photo in the inbox even if they later went inactive.
-- Anon only sees active ones (the public share link).
create policy gebet_profiles_select on public.gebet_profiles
  for select to authenticated using (true);
create policy gebet_profiles_select_public on public.gebet_profiles
  for select to anon using (is_active);
create policy gebet_profiles_insert on public.gebet_profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy gebet_profiles_update on public.gebet_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy gebet_profiles_delete on public.gebet_profiles
  for delete to authenticated using (user_id = auth.uid());
grant select on public.gebet_profiles to anon;

-- Swipes are written only through gebet_swipe() below; users can read/reset their own.
create policy gebet_swipes_select on public.gebet_swipes
  for select to authenticated using (swiper_id = auth.uid());
create policy gebet_swipes_delete on public.gebet_swipes
  for delete to authenticated using (swiper_id = auth.uid());

create policy gebet_comments_select on public.gebet_comments
  for select to authenticated using (target_id = auth.uid() or author_id = auth.uid());
create policy gebet_comments_insert on public.gebet_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.gebet_is_ready(auth.uid())
    and exists (select 1 from public.gebet_profiles g where g.user_id = target_id and g.is_active)
  );
create policy gebet_comments_delete on public.gebet_comments
  for delete to authenticated using (target_id = auth.uid() or author_id = auth.uid());

-- ---------------------------------------------------------------- RPCs

-- Next batch of people to swipe on: ready profiles, gender preferences compatible both ways,
-- not yourself, not already swiped.
create or replace function public.gebet_deck(p_limit int default 20)
returns table (
  user_id uuid, display_name text, gender text, city text, bio text,
  photo_url text, photo_uploaded_at timestamptz, age int
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (select * from public.gebet_profiles where user_id = auth.uid())
  select g.user_id, g.display_name, g.gender, g.city, g.bio, g.photo_url, g.photo_uploaded_at,
         public.gebet_age(g.user_id)
  from public.gebet_profiles g, me
  where g.user_id <> me.user_id
    and public.gebet_is_ready(g.user_id)
    and (me.interested_in = 'semua' or me.interested_in = g.gender)
    and (g.interested_in = 'semua' or g.interested_in = me.gender)
    and not exists (select 1 from public.gebet_swipes s where s.swiper_id = me.user_id and s.target_id = g.user_id)
  order by random()
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
grant execute on function public.gebet_deck(int) to authenticated;

-- One profile for the public link. Works logged out. Hidden (is_active=false) profiles return
-- nothing unless it's your own.
create or replace function public.gebet_public_profile(p_user_id uuid)
returns table (
  user_id uuid, display_name text, gender text, city text, bio text,
  photo_url text, photo_uploaded_at timestamptz, age int, is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select g.user_id, g.display_name, g.gender, g.city, g.bio, g.photo_url, g.photo_uploaded_at,
         public.gebet_age(g.user_id), g.is_active
  from public.gebet_profiles g
  where g.user_id = p_user_id
    and (g.is_active or g.user_id = auth.uid());
$$;
grant execute on function public.gebet_public_profile(uuid) to anon, authenticated;

-- Record a swipe; returns true when it creates a match (both liked each other), and drops a
-- notification to both people in that case.
create or replace function public.gebet_swipe(p_target uuid, p_like boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_matched boolean := false;
  v_my_name text;
  v_their_name text;
begin
  if v_me is null then raise exception 'Login dulu.'; end if;
  if p_target = v_me then raise exception 'Gak bisa swipe diri sendiri.'; end if;
  if not public.gebet_is_ready(v_me) then
    raise exception 'Lengkapin profil lo dulu (bio + foto terbaru).';
  end if;

  insert into public.gebet_swipes (swiper_id, target_id, liked)
  values (v_me, p_target, p_like)
  on conflict (swiper_id, target_id) do update set liked = excluded.liked, created_at = now();

  if p_like then
    select exists (
      select 1 from public.gebet_swipes where swiper_id = p_target and target_id = v_me and liked
    ) into v_matched;
  end if;

  if v_matched then
    select display_name into v_my_name from public.gebet_profiles where user_id = v_me;
    select display_name into v_their_name from public.gebet_profiles where user_id = p_target;
    insert into public.notifications (user_id, title, message, kind, link_url, created_by) values
      (p_target, '💘 Match!', 'Lo sama ' || coalesce(v_my_name, 'seseorang') || ' saling suka. Sapa duluan gih.', 'gebet_match', 'gebet.html?u=' || v_me, v_me),
      (v_me, '💘 Match!', 'Lo sama ' || coalesce(v_their_name, 'seseorang') || ' saling suka. Sapa duluan gih.', 'gebet_match', 'gebet.html?u=' || p_target, v_me);
  end if;
  return v_matched;
end;
$$;
grant execute on function public.gebet_swipe(uuid, boolean) to authenticated;

create or replace function public.gebet_matches()
returns table (
  user_id uuid, display_name text, city text, photo_url text, age int, matched_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select g.user_id, g.display_name, g.city, g.photo_url, public.gebet_age(g.user_id),
         greatest(a.created_at, b.created_at)
  from public.gebet_swipes a
  join public.gebet_swipes b on b.swiper_id = a.target_id and b.target_id = a.swiper_id and b.liked
  join public.gebet_profiles g on g.user_id = a.target_id
  where a.swiper_id = auth.uid() and a.liked
  order by 6 desc;
$$;
grant execute on function public.gebet_matches() to authenticated;

-- New comment -> notification to the photo owner, linking straight to the commenter's profile.
create or replace function public.gebet_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select display_name into v_name from public.gebet_profiles where user_id = new.author_id;
  insert into public.notifications (user_id, title, message, kind, link_url, created_by)
  values (
    new.target_id,
    '💬 ' || coalesce(v_name, 'Seseorang') || ' komen di foto lo',
    left(new.body, 140),
    'gebet_comment',
    'gebet.html?u=' || new.author_id,
    new.author_id
  );
  return new;
end;
$$;

drop trigger if exists gebet_comments_notify on public.gebet_comments;
create trigger gebet_comments_notify
  after insert on public.gebet_comments
  for each row execute function public.gebet_comment_notify();

-- ---------------------------------------------------------------- storage

-- Public bucket: the share link has to load the photo for logged-out visitors. Each user may only
-- write inside their own <user_id>/ folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gebet-photos', 'gebet-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gebet_photos_select on storage.objects;
create policy gebet_photos_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'gebet-photos');

drop policy if exists gebet_photos_insert on storage.objects;
create policy gebet_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gebet-photos' and owner = auth.uid() and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists gebet_photos_delete on storage.objects;
create policy gebet_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gebet-photos' and owner = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gebet_comments'
  ) then
    alter publication supabase_realtime add table public.gebet_comments;
  end if;
end $$;

insert into public._migrations (filename) values ('0038_gebet_dating.sql')
  on conflict (filename) do nothing;

commit;
