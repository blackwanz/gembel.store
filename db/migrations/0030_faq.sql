-- 0030_faq.sql
-- FAQ, editable as a lightweight CMS: admin.html gets a tab to write/edit/reorder entries,
-- faq.html renders them for everyone -- including a visitor who isn't signed in yet, since the
-- whole point is helping someone navigate/decide BEFORE they commit to an account. This is only
-- the second table in this schema granting the anon role anything at all (see
-- 0025_kitchens_public_share.sql for the first, and its notes on why that's worth calling out
-- explicitly) -- anon only ever gets SELECT on published rows here, never write.

begin;

create table if not exists public.faq_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text not null default 'Umum',
  sort_order integer not null default 0,
  published boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faq_entries_order_idx on public.faq_entries(category, sort_order);

alter table public.faq_entries enable row level security;

-- Public + member read of published entries. Admin also needs to see unpublished (draft) rows
-- while editing, hence the separate admin-select policy below rather than folding it into one.
create policy faq_entries_select_public on public.faq_entries
  for select to anon, authenticated
  using (published);

create policy faq_entries_select_admin on public.faq_entries
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy faq_entries_insert on public.faq_entries
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy faq_entries_update on public.faq_entries
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy faq_entries_delete on public.faq_entries
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public._migrations (filename) values ('0030_faq.sql')
  on conflict (filename) do nothing;

commit;
