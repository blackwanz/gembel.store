-- 0033_stock_history.sql
-- Adds a history log to Stok Dapur (masak.html): every time a stock_items row is removed
-- because it got eaten/cooked or thrown away, a stock_history row records what, how much,
-- when, who did it, and which of the two happened. stock_items itself has no "removed" state --
-- removal has always meant deleting the row (see the two "Habis dipakai"/"Buang" buttons and the
-- quick command bar in masak.html) -- so this is a separate append-only table, not a column on
-- stock_items.
--
-- Design notes:
--   * item_name/qty/unit are copied at removal time rather than kept as a foreign key to
--     stock_items, because the whole point is to survive the item's own row being deleted.
--   * No update/delete policies on purpose -- a history log that anyone can edit after the fact
--     isn't a history log. If a mistaken entry needs correcting, that's a manual DB fix, not an
--     app feature.
--   * acted_by references auth.users with on delete set null (matches stock_items.created_by's
--     existing pattern) so a deleted account doesn't cascade-delete history rows.

begin;

create table if not exists public.stock_history (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  item_name text not null,
  qty numeric not null,
  unit text not null,
  action text not null check (action in ('eaten', 'discarded')),
  acted_by uuid references auth.users(id) on delete set null,
  acted_at timestamptz not null default now()
);

create index if not exists stock_history_kitchen_idx on public.stock_history(kitchen_id);
create index if not exists stock_history_acted_at_idx on public.stock_history(kitchen_id, acted_at desc);

alter table public.stock_history enable row level security;

create policy stock_history_select on public.stock_history
  for select to authenticated
  using (exists (
    select 1 from public.kitchen_members km
    where km.kitchen_id = stock_history.kitchen_id and km.user_id = auth.uid()
  ));

create policy stock_history_insert on public.stock_history
  for insert to authenticated
  with check (
    acted_by = auth.uid()
    and exists (
      select 1 from public.kitchen_members km
      where km.kitchen_id = stock_history.kitchen_id and km.user_id = auth.uid() and km.role in ('owner', 'editor')
    )
  );

insert into public._migrations (filename) values ('0033_stock_history.sql')
  on conflict (filename) do nothing;

commit;
