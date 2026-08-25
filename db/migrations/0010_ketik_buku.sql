-- 0010_ketik_buku.sql
-- Backs the new Ketik Buku (typing practice) app: each user's own library
-- of imported book texts (PDF text extraction happens entirely client-side
-- in the browser -- only the resulting plain text is ever sent here),
-- saved vocabulary, typing session history, and settings.
--
-- Private per user, NOT a shared library (unlike Save File's shared
-- drop-box) -- each person's imported books/vocab/stats are their own,
-- matching how the source app already treats a book's reading position
-- (`offset`) as living directly on the book record itself (single-owner
-- model, no concept of multiple readers of the same book).
--
-- id columns are TEXT: the source app generates its own ids client-side
-- (same 'prefix' + timestamp + random pattern as every other app here).

begin;

create table if not exists public.ketik_books (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source text null,
  text_content text not null,
  chars integer not null default 0,
  words integer not null default 0,
  added_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  reading_offset integer not null default 0
);

create index if not exists ketik_books_user_id_idx on public.ketik_books(user_id);

alter table public.ketik_books enable row level security;
create policy ketik_books_select on public.ketik_books for select to authenticated using (auth.uid() = user_id);
create policy ketik_books_insert on public.ketik_books for insert to authenticated with check (auth.uid() = user_id);
create policy ketik_books_update on public.ketik_books for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy ketik_books_delete on public.ketik_books for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.ketik_vocab (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  meaning text null,
  pos text null,
  base_word text null,
  context text null,
  book_id text null,
  saved_at timestamptz not null default now()
);

create index if not exists ketik_vocab_user_id_idx on public.ketik_vocab(user_id);

alter table public.ketik_vocab enable row level security;
create policy ketik_vocab_select on public.ketik_vocab for select to authenticated using (auth.uid() = user_id);
create policy ketik_vocab_insert on public.ketik_vocab for insert to authenticated with check (auth.uid() = user_id);
create policy ketik_vocab_update on public.ketik_vocab for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy ketik_vocab_delete on public.ketik_vocab for delete to authenticated using (auth.uid() = user_id);

-- Append-only history: synced by insert-only (see focus.html-style apps'
-- full-reconcile vs this one) so trimming the local "last 400" cache
-- never deletes older rows already saved in the cloud -- that local trim
-- is a browser-storage-size cap, not a "delete old history" decision, and
-- moving to a real backend removes the reason for that cap to apply here.
create table if not exists public.ketik_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text null,
  book_title text null,
  wpm integer null,
  accuracy numeric null,
  chars integer null,
  errors integer null,
  secs integer null,
  chunks integer null,
  best_streak integer null,
  occurred_at timestamptz not null default now()
);

create index if not exists ketik_sessions_user_id_idx on public.ketik_sessions(user_id);

alter table public.ketik_sessions enable row level security;
create policy ketik_sessions_select on public.ketik_sessions for select to authenticated using (auth.uid() = user_id);
create policy ketik_sessions_insert on public.ketik_sessions for insert to authenticated with check (auth.uid() = user_id);
create policy ketik_sessions_delete on public.ketik_sessions for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.ketik_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sound boolean not null default true,
  profile text not null default 'mech',
  vol numeric not null default 0.55,
  words_per_chunk integer not null default 30,
  peek boolean not null default true,
  strict boolean not null default false
);

alter table public.ketik_settings enable row level security;
create policy ketik_settings_select on public.ketik_settings for select to authenticated using (auth.uid() = user_id);
create policy ketik_settings_insert on public.ketik_settings for insert to authenticated with check (auth.uid() = user_id);
create policy ketik_settings_update on public.ketik_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy ketik_settings_delete on public.ketik_settings for delete to authenticated using (auth.uid() = user_id);

insert into public._migrations (filename) values ('0010_ketik_buku.sql')
  on conflict (filename) do nothing;

commit;
