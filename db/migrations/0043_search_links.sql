-- 0043_search_links.sql
-- Gembel.com (cari.html): a Google-style search box over bookmarks people save themselves.
-- Each link is private (only its owner ever gets the row back) or public (anyone -- including
-- signed-out visitors -- can find it). Privacy is enforced here by RLS, not by the page: the
-- select policy simply never returns someone else's private row.

begin;

create table if not exists public.search_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null check (url ~* '^https?://' and length(url) <= 2000),
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 500),
  tags text[] not null default '{}',
  is_public boolean not null default false,
  click_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists search_links_user_idx on public.search_links(user_id);
create index if not exists search_links_public_idx on public.search_links(is_public) where is_public;

alter table public.search_links enable row level security;

drop policy if exists search_links_select on public.search_links;
create policy search_links_select on public.search_links
  for select using (is_public or auth.uid() = user_id);
drop policy if exists search_links_insert on public.search_links;
create policy search_links_insert on public.search_links
  for insert with check (auth.uid() = user_id);
drop policy if exists search_links_update on public.search_links;
create policy search_links_update on public.search_links
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists search_links_delete on public.search_links;
create policy search_links_delete on public.search_links
  for delete using (auth.uid() = user_id);

grant select on public.search_links to anon;
grant all on public.search_links to authenticated, service_role;

-- Popularity counter for ranking. Visitors can't update rows they don't own, so this is the one
-- narrow write they get: +1 on a link they're allowed to see anyway.
create or replace function public.search_links_click(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.search_links set click_count = click_count + 1
  where id = p_id and (is_public or user_id = auth.uid());
$$;

grant execute on function public.search_links_click(uuid) to anon, authenticated;

-- Owner name shown next to public results; profiles itself isn't readable by signed-out visitors.
create or replace function public.search_link_owners(p_ids uuid[])
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
  from public.profiles p
  where p.id = any(p_ids)
    and exists (select 1 from public.search_links l where l.user_id = p.id and l.is_public);
$$;

grant execute on function public.search_link_owners(uuid[]) to anon, authenticated;

insert into public._migrations (filename) values ('0043_search_links.sql')
  on conflict (filename) do nothing;

commit;
