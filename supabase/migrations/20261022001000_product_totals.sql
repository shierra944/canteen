-- =====================================================================
-- Migration 10: running totals per product
--   delivered = everything handed over to the canteen so far
--               (consigned: Σ total quantity on saved daily sales sheets;
--                canteen stock: stock received — opening + stock-in)
--   sold      = Σ sold quantity on saved daily sales sheets
-- Saved sheets = drafts and finalized records. Lines imported from the
-- workbook (not linked to a product) are matched by name + consignee,
-- ignoring case, spaces and punctuation.
-- =====================================================================

create or replace function public.norm_key(p text)
returns text
language sql immutable
as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g')
$$;

create index if not exists daily_sale_items_norm_idx
  on public.daily_sale_items (public.norm_key(item_name_snapshot), public.norm_key(consignee))
  where inventory_item_id is null;

create view public.v_product_totals with (security_invoker = true) as
with lines as (
  select i.id as item_id, l.total_quantity, l.sold_quantity, d.sale_date
  from public.inventory_items i
  join public.daily_sale_items l on l.inventory_item_id = i.id
  join public.daily_sales d on d.id = l.daily_sale_id
  union all
  select i.id, l.total_quantity, l.sold_quantity, d.sale_date
  from public.inventory_items i
  left join public.consignees c on c.id = i.consignee_id
  join public.daily_sale_items l
    on l.inventory_item_id is null
   and public.norm_key(l.item_name_snapshot) = public.norm_key(i.name)
   and public.norm_key(l.consignee) = public.norm_key(coalesce(c.name, i.default_consignee))
  join public.daily_sales d on d.id = l.daily_sale_id
),
agg as (
  select item_id, sum(total_quantity) as delivered, sum(sold_quantity) as sold,
         count(distinct sale_date) as days, max(sale_date) as last_sale_date
  from lines group by item_id
),
received as (
  select item_id, sum(quantity) as received
  from public.inventory_transactions
  where transaction_type in ('opening', 'stock_in', 'stock_in_reversal')
  group by item_id
)
select i.id as item_id,
       case when i.is_consigned then coalesce(a.delivered, 0) else coalesce(r.received, 0) end as delivered,
       coalesce(a.sold, 0) as sold,
       coalesce(a.days, 0) as days,
       a.last_sale_date
from public.inventory_items i
left join agg a on a.item_id = i.id
left join received r on r.item_id = i.id;

grant select on public.v_product_totals to authenticated;
revoke all on public.v_product_totals from anon;
