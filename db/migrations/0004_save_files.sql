-- 0004_save_files.sql
-- Backs the new "Save File" upload app: a shared drop-box where any logged-in
-- user can upload/download/see everyone's files, but can only delete their
-- own. Storage bucket + object policies live in Supabase's built-in
-- storage.buckets/storage.objects tables; save_files is our own metadata
-- table for listing/sorting without hitting the Storage API for every list.

begin;

-- 50 MB per file, enforced server-side by Supabase Storage itself (not just
-- the client-side check in save-file.html) -- 52428800 bytes = 50 * 1024 * 1024.
-- public=false: the bucket itself isn't world-readable: every read goes
-- through a signed URL (issued only to authenticated users) or through the
-- policies below, so a logged-out visitor can't reach any file at all.
insert into storage.buckets (id, name, public, file_size_limit)
values ('save-files', 'save-files', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Any authenticated user can see/download any file in this bucket (shared
-- drop-box, per product decision); only the uploader (storage's own
-- `owner` column, set automatically by the Storage API from the caller's
-- JWT) can delete it.
drop policy if exists save_files_storage_select on storage.objects;
create policy save_files_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'save-files');

drop policy if exists save_files_storage_insert on storage.objects;
create policy save_files_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'save-files' and owner = auth.uid());

drop policy if exists save_files_storage_delete on storage.objects;
create policy save_files_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'save-files' and owner = auth.uid());

-- Metadata mirror of what's in the bucket -- lets the app list/sort/show
-- "uploaded by" without paginating the Storage API on every page load.
create table if not exists public.save_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  content_type text null,
  created_at timestamptz not null default now()
);

create index if not exists save_files_created_at_idx on public.save_files(created_at desc);
create index if not exists save_files_user_id_idx on public.save_files(user_id);

alter table public.save_files enable row level security;

create policy save_files_select on public.save_files
  for select to authenticated
  using (true);
create policy save_files_insert on public.save_files
  for insert to authenticated
  with check (auth.uid() = user_id);
create policy save_files_delete on public.save_files
  for delete to authenticated
  using (auth.uid() = user_id);

insert into public._migrations (filename) values ('0004_save_files.sql')
  on conflict (filename) do nothing;

commit;
