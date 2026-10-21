-- =====================================================================
-- Migration 8: per-line canteen share and consignee remittance
--
-- Canteen share per piece for each daily sales line:
--   * canteen-stock item ............ the full selling price (canteen revenue)
--   * consigned item with cost price . selling price − cost price
--   * consigned item without cost .... the canteen share rate (workbook: ₱1)
-- Canteen share  = share quantity × share per piece
-- Remit to consignee = sales amount − canteen share
-- With no cost prices this equals the workbook (Σ SHARE × ₱1).
-- =====================================================================

alter table public.daily_sale_items
  add column cost_price numeric(12,2) check (cost_price >= 0),
  add column is_canteen_stock boolean not null default false;
alter table public.daily_sale_items
  add constraint daily_sale_items_cost_le_price check (cost_price is null or cost_price <= unit_price);

-- existing lines linked to canteen-owned stock items
update public.daily_sale_items i set is_canteen_stock = true
  from public.inventory_items it
 where it.id = i.inventory_item_id and not it.is_consigned;

create or replace function public.line_share_per_piece(
  p_is_canteen_stock boolean, p_unit_price numeric, p_cost_price numeric, p_rate numeric)
returns numeric
language sql immutable
as $$
  select case when p_is_canteen_stock then p_unit_price
              when p_cost_price is not null then p_unit_price - p_cost_price
              else p_rate end
$$;

create view public.v_daily_sale_lines with (security_invoker = true) as
select i.*,
       r.rate as share_rate_applied,
       public.line_share_per_piece(i.is_canteen_stock, i.unit_price, i.cost_price, r.rate) as share_per_piece,
       round(i.share_quantity * public.line_share_per_piece(i.is_canteen_stock, i.unit_price, i.cost_price, r.rate), 2) as canteen_share,
       i.sales_amount - round(i.share_quantity * public.line_share_per_piece(i.is_canteen_stock, i.unit_price, i.cost_price, r.rate), 2) as remit_amount
from public.daily_sale_items i
join public.daily_sales d on d.id = i.daily_sale_id
cross join lateral (
  select coalesce(d.share_rate, (select canteen_share_rate from public.school_settings where id = 1)) as rate
) r;
grant select on public.v_daily_sale_lines to authenticated;
revoke all on public.v_daily_sale_lines from anon;

-- Same columns as before (canteen_shares now uses the per-line rule) plus remit_total.
create or replace view public.v_daily_sales with (security_invoker = true) as
select d.*,
       coalesce(t.line_count, 0) as line_count,
       coalesce(t.total_quantity, 0) as total_quantity,
       coalesce(t.units_sold, 0) as units_sold,
       coalesce(t.sales_amount, 0) as sales_amount,
       coalesce(t.unsold_units, 0) as unsold_units,
       coalesce(t.unsold_amount, 0) as unsold_amount,
       coalesce(t.share_units, 0) as share_units,
       coalesce(t.canteen_share, 0) as canteen_shares,
       pc.full_name as created_by_name,
       pf.full_name as finalized_by_name,
       coalesce(t.remit, 0) as remit_total
from public.daily_sales d
left join lateral (
  select count(*) as line_count, sum(total_quantity) as total_quantity, sum(sold_quantity) as units_sold,
         sum(sales_amount) as sales_amount, sum(unsold_quantity) as unsold_units,
         sum(unsold_amount) as unsold_amount, sum(share_quantity) as share_units,
         sum(canteen_share) as canteen_share, sum(remit_amount) as remit
  from public.v_daily_sale_lines l where l.daily_sale_id = d.id
) t on true
left join public.profiles pc on pc.id = d.created_by
left join public.profiles pf on pf.id = d.finalized_by;

create or replace function public.save_daily_sale(
  p_id uuid,
  p_sale_date date,
  p_actual_money numeric,
  p_remarks text,
  p_lines jsonb,
  p_expected_version integer default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.daily_sales;
  v_line jsonb;
  v_no integer := 0;
  v_item public.inventory_items;
  v_name text;
  v_total numeric;
  v_sold numeric;
  v_share numeric;
  v_price numeric;
  v_cost numeric;
  v_stock boolean;
begin
  perform public.require_permission('sales.record');
  if p_sale_date is null then raise exception 'Sale date is required.'; end if;
  if p_sale_date > public.today_ph() then raise exception 'Daily sales cannot be recorded for a future date.'; end if;
  if p_actual_money is not null and p_actual_money < 0 then raise exception 'Actual money cannot be negative.'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Invalid line items.'; end if;

  if p_id is null then
    if exists (select 1 from public.daily_sales where sale_date = p_sale_date) then
      raise exception 'A daily sales record for % already exists. Open it from the history instead.',
        to_char(p_sale_date, 'FMMonth DD, YYYY') using errcode = '23505';
    end if;
    insert into public.daily_sales (sale_date, actual_money, remarks, created_by, updated_by)
    values (p_sale_date, p_actual_money, nullif(trim(p_remarks), ''), auth.uid(), auth.uid())
    returning * into v_sale;
  else
    select * into v_sale from public.daily_sales where id = p_id for update;
    if v_sale.id is null then raise exception 'Daily sales record not found.'; end if;
    if v_sale.status <> 'draft' then
      raise exception 'This daily sales record is finalized. Reopen it for correction first.';
    end if;
    if p_expected_version is not null and p_expected_version <> v_sale.version then
      raise exception 'This record was changed by another user. Reload to see the latest version.'
        using errcode = '40001';
    end if;
    if p_sale_date <> v_sale.sale_date and exists (select 1 from public.daily_sales where sale_date = p_sale_date) then
      raise exception 'A daily sales record for % already exists.', to_char(p_sale_date, 'FMMonth DD, YYYY');
    end if;
    update public.daily_sales
       set sale_date = p_sale_date, actual_money = p_actual_money, remarks = nullif(trim(p_remarks), ''),
           version = version + 1, updated_by = auth.uid()
     where id = v_sale.id
     returning * into v_sale;
    delete from public.daily_sale_items where daily_sale_id = v_sale.id;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_no := v_no + 1;
    v_item := null;
    if nullif(v_line ->> 'inventory_item_id', '') is not null then
      select * into v_item from public.inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
      if v_item.id is null then raise exception 'Line %: inventory item not found.', v_no; end if;
    end if;
    v_name := coalesce(nullif(trim(v_line ->> 'item_name'), ''), v_item.name);
    if v_name is null then raise exception 'Line %: item name is required.', v_no; end if;
    v_total := coalesce((v_line ->> 'total_quantity')::numeric, 0);
    v_sold := coalesce((v_line ->> 'sold_quantity')::numeric, 0);
    v_price := coalesce((v_line ->> 'unit_price')::numeric, v_item.selling_price, 0);
    v_share := coalesce((v_line ->> 'share_quantity')::numeric, v_sold);
    v_stock := v_item.id is not null and not v_item.is_consigned;
    -- cost price: the line value if given, else the consigned product's cost (0 = unknown)
    v_cost := case when v_stock then null
                   when v_line ? 'cost_price' then nullif(v_line ->> 'cost_price', '')::numeric
                   else nullif(v_item.unit_cost, 0) end;
    if v_total < 0 or v_sold < 0 or v_share < 0 or v_price < 0 or coalesce(v_cost, 0) < 0 then
      raise exception 'Line % (%): quantities and prices cannot be negative.', v_no, v_name;
    end if;
    if v_sold > v_total then
      raise exception 'Line % (%): sold quantity (%) exceeds total quantity (%).',
        v_no, v_name, trim_scale(v_sold), trim_scale(v_total);
    end if;
    if v_cost is not null and v_cost > v_price then
      raise exception 'Line % (%): cost price (₱%) is higher than the selling price (₱%).',
        v_no, v_name, trim_scale(v_cost), trim_scale(v_price);
    end if;
    insert into public.daily_sale_items (
      daily_sale_id, line_no, inventory_item_id, item_name_snapshot, unit_snapshot, consignee,
      total_quantity, unit_price, sold_quantity, share_quantity, cost_price, is_canteen_stock)
    values (
      v_sale.id, v_no, v_item.id, v_name, coalesce(v_item.unit, nullif(v_line ->> 'unit', '')),
      nullif(trim(v_line ->> 'consignee'), ''), v_total, v_price, v_sold, v_share, v_cost, coalesce(v_stock, false));
  end loop;

  return jsonb_build_object('id', v_sale.id, 'version', v_sale.version);
end
$$;
