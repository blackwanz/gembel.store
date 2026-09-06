-- db/check_table_dependencies.sql
-- Non-destructive. Run this after habbit_d's drop failed with 2BP01 --
-- it lists EVERY object (function, view, trigger, etc.) that depends on
-- any of the 12 drop-candidate tables, either directly or via their
-- implicit composite row type (which is what tripped up habbit_d: a
-- function using `habbit_d` as a parameter/return type, not the table's
-- data). Better to see the full picture once than hit these one at a time.

with cand as (
  select c.oid as tbl_oid, c.relname, t.oid as type_oid
  from pg_class c
  join pg_type t on t.typrelid = c.oid
  where c.relnamespace = 'public'::regnamespace
    and c.relname = any(array[
      'apps', 'calender_h', 'calender_e', 'progbar_c', 'progbar_h', 'progbar_h2',
      'habbit_h', 'habbit_d', 'meditate_h', 'trade_master_c', 'trade_master_h',
      'payment_request'
    ])
)
select
  cand.relname as blocked_table,
  pg_describe_object(d.classid, d.objid, d.objsubid) as dependent_object,
  d.deptype
from pg_depend d
join cand
  on (d.refobjid = cand.tbl_oid and d.refclassid = 'pg_class'::regclass)
  or (d.refobjid = cand.type_oid and d.refclassid = 'pg_type'::regclass)
where d.deptype <> 'i'
order by cand.relname, dependent_object;
