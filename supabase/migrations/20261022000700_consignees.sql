-- =====================================================================
-- Migration 7: consignees and consigned (non-stock-tracked) products
--
-- Most items in the DAILY SALES sheet are brought in daily by consignees
-- (Judy Ann, Jean, Emily, ...). They are sold through the canteen but are
-- NOT canteen stock, so they must never be deducted from inventory.
-- Canteen-owned goods (rice, bottled water, napkins ...) stay stock-tracked.
-- =====================================================================

create table public.consignees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  contact_number text,
  address text,
  remarks text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index consignees_name_key on public.consignees (lower(trim(name)));
create trigger consignees_touch before update on public.consignees for each row execute function public.touch_updated_at();
create trigger consignees_audit after insert or update or delete on public.consignees for each row execute function public.audit_row_change();

alter table public.consignees enable row level security;
revoke all on public.consignees from anon;
revoke delete on public.consignees from authenticated;
create policy "active users read" on public.consignees for select to authenticated using (public.is_active_user());
create policy "inventory managers insert" on public.consignees for insert to authenticated
  with check (public.has_permission('inventory.manage'));
create policy "inventory managers update" on public.consignees for update to authenticated
  using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));

alter table public.inventory_items
  add column is_consigned boolean not null default false,
  add column consignee_id uuid references public.consignees (id);
-- consigned goods are never held as canteen stock
alter table public.inventory_items
  add constraint inventory_items_consigned_no_stock check (not is_consigned or quantity_on_hand = 0);
create index inventory_items_consignee_idx on public.inventory_items (consignee_id);

grant update (is_consigned, consignee_id) on public.inventory_items to authenticated;

-- Automatic item codes: CN-0001 for consigned items, ITM-0001 otherwise.
create sequence public.item_code_seq;
create or replace function public.next_item_code(p_consigned boolean)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  loop
    v_code := case when p_consigned then 'CN-' else 'ITM-' end || lpad(nextval('public.item_code_seq')::text, 4, '0');
    exit when not exists (select 1 from public.inventory_items where lower(item_code) = lower(v_code));
  end loop;
  return v_code;
end
$$;

-- ---------------------------------------------------------------------
-- Views / functions updated for consigned items
-- ---------------------------------------------------------------------
drop view public.v_inventory_items;
create view public.v_inventory_items with (security_invoker = true) as
select i.*,
       c.name as category_name,
       s.name as supplier_name,
       cn.name as consignee_name,
       case when i.is_consigned then 'consigned'
            else public.stock_status(i.quantity_on_hand, i.reorder_level) end as stock_status
from public.inventory_items i
left join public.inventory_categories c on c.id = i.category_id
left join public.suppliers s on s.id = i.supplier_id
left join public.consignees cn on cn.id = i.consignee_id;
grant select on public.v_inventory_items to authenticated;
revoke all on public.v_inventory_items from anon;

-- Stock can never move for a consigned item.
create or replace function public._apply_stock(
  p_item_id uuid,
  p_type public.inv_txn_type,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_reason text,
  p_txn_date date,
  p_allow_negative boolean default false,
  p_reverses uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items;
  v_new_qty numeric(12,3);
  v_new_cost numeric(12,2);
  v_valuation text;
  v_exception boolean := false;
  v_txn_id uuid;
begin
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Quantity must not be zero.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Inventory item not found.';
  end if;
  if v_item.is_consigned then
    raise exception '"%" is a consigned item and is not stock-tracked.', v_item.name;
  end if;

  v_new_qty := v_item.quantity_on_hand + p_quantity;
  if v_new_qty < 0 then
    if not p_allow_negative then
      raise exception 'Insufficient stock for "%": % on hand, % required. An administrator can authorise a documented exception.',
        v_item.name, trim_scale(v_item.quantity_on_hand), trim_scale(abs(p_quantity))
        using errcode = 'P0001', hint = 'insufficient_stock';
    end if;
    if not public.has_permission('inventory.negative_exception') then
      raise exception 'Only an administrator can authorise negative stock for "%".', v_item.name using errcode = '42501';
    end if;
    if length(trim(coalesce(p_reason, ''))) = 0 then
      raise exception 'A documented reason is required for a negative-stock exception.';
    end if;
    v_exception := true;
  end if;

  v_new_cost := v_item.unit_cost;
  if p_type in ('stock_in', 'opening') and p_unit_cost is not null then
    select inventory_valuation into v_valuation from public.school_settings where id = 1;
    if v_valuation = 'latest_cost' or v_item.quantity_on_hand <= 0 then
      v_new_cost := p_unit_cost;
    else
      v_new_cost := round((v_item.quantity_on_hand * v_item.unit_cost + p_quantity * p_unit_cost) / v_new_qty, 2);
    end if;
  end if;

  perform set_config('app.stock_write', 'on', true);
  update public.inventory_items
     set quantity_on_hand = v_new_qty, unit_cost = v_new_cost
   where id = p_item_id;
  perform set_config('app.stock_write', 'off', true);

  insert into public.inventory_transactions (
    item_id, transaction_type, txn_date, quantity, unit_cost, balance_before, balance_after,
    reference_type, reference_id, reason, is_exception, reverses_id, created_by)
  values (
    p_item_id, p_type, coalesce(p_txn_date, public.today_ph()), p_quantity,
    coalesce(p_unit_cost, v_item.unit_cost), v_item.quantity_on_hand, v_new_qty,
    p_reference_type, p_reference_id, p_reason, v_exception, p_reverses, auth.uid())
  returning id into v_txn_id;

  return v_txn_id;
end
$$;

create or replace function public.create_inventory_item(p jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_consigned boolean := coalesce((p ->> 'is_consigned')::boolean, false);
  v_initial numeric := case when coalesce((p ->> 'is_consigned')::boolean, false) then 0
                            else coalesce((p ->> 'initial_quantity')::numeric, 0) end;
  v_default_reorder numeric;
  v_code text := upper(trim(coalesce(p ->> 'item_code', '')));
begin
  perform public.require_permission('inventory.manage');
  if v_initial < 0 then
    raise exception 'Initial stock cannot be negative.';
  end if;
  if v_consigned and nullif(p ->> 'consignee_id', '') is null then
    raise exception 'Choose the consignee for a consigned item.';
  end if;
  if v_code = '' then
    v_code := public.next_item_code(v_consigned);
  end if;
  select default_reorder_level into v_default_reorder from public.school_settings where id = 1;

  begin
    insert into public.inventory_items (
      item_code, name, category_id, unit, unit_cost, selling_price, reorder_level,
      supplier_id, expiration_date, description, default_consignee, is_consigned, consignee_id,
      created_by, updated_by)
    values (
      v_code, trim(p ->> 'name'), nullif(p ->> 'category_id', '')::uuid,
      coalesce(nullif(trim(p ->> 'unit'), ''), 'piece'),
      coalesce((p ->> 'unit_cost')::numeric, 0), coalesce((p ->> 'selling_price')::numeric, 0),
      case when v_consigned then 0 else coalesce((p ->> 'reorder_level')::numeric, v_default_reorder) end,
      nullif(p ->> 'supplier_id', '')::uuid, nullif(p ->> 'expiration_date', '')::date,
      nullif(trim(p ->> 'description'), ''),
      case when v_consigned then (select name from public.consignees where id = (p ->> 'consignee_id')::uuid)
           else nullif(trim(p ->> 'default_consignee'), '') end,
      v_consigned, nullif(p ->> 'consignee_id', '')::uuid,
      auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Item code "%" is already used by another item.', v_code;
  end;

  if v_initial > 0 then
    perform public._apply_stock(v_id, 'opening', v_initial, coalesce((p ->> 'unit_cost')::numeric, 0),
                                'item_create', v_id, 'Initial stock on item creation', public.today_ph());
  end if;
  return v_id;
end
$$;

-- Keep the denormalised consignee name in step with consignee_id.
create or replace function public.sync_item_consignee()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_consigned and new.consignee_id is null then
    raise exception 'Choose the consignee for a consigned item.';
  end if;
  if new.consignee_id is not null then
    new.default_consignee := (select name from public.consignees where id = new.consignee_id);
  end if;
  if new.is_consigned then
    new.reorder_level := 0;
  end if;
  return new;
end
$$;
create trigger inventory_items_sync_consignee before insert or update of is_consigned, consignee_id on public.inventory_items
  for each row execute function public.sync_item_consignee();

create or replace function public.finalize_daily_sale(
  p_id uuid,
  p_allow_negative boolean default false,
  p_exception_reason text default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.daily_sales;
  v_line record;
  v_txn uuid;
  v_rate numeric;
begin
  perform public.require_permission('sales.finalize');
  select * into v_sale from public.daily_sales where id = p_id for update;
  if v_sale.id is null then raise exception 'Daily sales record not found.'; end if;
  if v_sale.status <> 'draft' then raise exception 'This daily sales record is already finalized.'; end if;
  if not exists (select 1 from public.daily_sale_items where daily_sale_id = p_id) then
    raise exception 'Add at least one item before finalizing.';
  end if;
  if p_allow_negative then
    perform public.require_permission('inventory.negative_exception');
  end if;

  -- Deduct canteen stock exactly once per line; consigned goods are skipped.
  if v_sale.source = 'manual' then
    for v_line in
      select i.* from public.daily_sale_items i
      join public.inventory_items it on it.id = i.inventory_item_id and not it.is_consigned
       where i.daily_sale_id = p_id and i.sold_quantity > 0 and i.posted_txn_id is null
       order by i.inventory_item_id, i.line_no
    loop
      v_txn := public._apply_stock(
        v_line.inventory_item_id, 'sale', -v_line.sold_quantity, null,
        'daily_sale_item', v_line.id,
        'Daily sales ' || to_char(v_sale.sale_date, 'YYYY-MM-DD') ||
          coalesce(' — exception: ' || nullif(trim(p_exception_reason), ''), ''),
        v_sale.sale_date, p_allow_negative);
      update public.daily_sale_items set posted_txn_id = v_txn where id = v_line.id;
    end loop;
  end if;

  select canteen_share_rate into v_rate from public.school_settings where id = 1;
  update public.daily_sales
     set status = 'finalized',
         share_rate = coalesce(share_rate, v_rate),
         finalized_by = auth.uid(), finalized_at = now(),
         inventory_posted = (source = 'manual'),
         version = version + 1, updated_by = auth.uid()
   where id = p_id;

  perform public.log_audit('finalize_daily_sale', 'daily_sales', p_id::text, null,
                           public.daily_sale_snapshot(p_id), p_exception_reason);
end
$$;

create or replace function public.dashboard_metrics(p_start date, p_end date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select public.report_period_totals(p_start, p_end) || jsonb_build_object(
    'inventory_value', (select coalesce(sum(stock_value), 0) from public.inventory_items where is_active and not is_consigned),
    'inventory_valuation', (select inventory_valuation from public.school_settings where id = 1),
    'items_active', (select count(*) from public.inventory_items where is_active and not is_consigned),
    'items_consigned', (select count(*) from public.inventory_items where is_active and is_consigned),
    'items_in_stock', (select count(*) from public.inventory_items
                        where is_active and not is_consigned and public.stock_status(quantity_on_hand, reorder_level) = 'in_stock'),
    'items_low_stock', (select count(*) from public.inventory_items
                         where is_active and not is_consigned and public.stock_status(quantity_on_hand, reorder_level) = 'low_stock'),
    'items_out_of_stock', (select count(*) from public.inventory_items
                            where is_active and not is_consigned and public.stock_status(quantity_on_hand, reorder_level) = 'out_of_stock'),
    'draft_daily_sales', (select count(*) from public.daily_sales where status = 'draft'
                            and sale_date between p_start and p_end),
    'deduct_deficit_in_net', (select deduct_deficit_in_net from public.school_settings where id = 1),
    'formula_confirmed', (select formula_confirmed_at is not null from public.school_settings where id = 1)
  )
$$;

create or replace function public.report_inventory_movement(p_start date, p_end date)
returns table (
  item_id uuid, item_code text, item_name text, category_name text, unit text,
  opening numeric, received numeric, sold numeric, losses numeric, other_adjustments numeric,
  closing numeric, quantity_on_hand numeric, ledger_balance numeric, reconciled boolean,
  unit_cost numeric, stock_value numeric, reorder_level numeric, stock_status text, is_active boolean
)
language sql stable
set search_path = public, pg_temp
as $$
  select i.id, i.item_code, i.name, c.name, i.unit,
         coalesce(sum(t.quantity) filter (where t.txn_date < p_start), 0),
         coalesce(sum(t.quantity) filter (where t.txn_date between p_start and p_end
                  and t.transaction_type in ('opening','stock_in','stock_in_reversal')), 0),
         -coalesce(sum(t.quantity) filter (where t.txn_date between p_start and p_end
                  and t.transaction_type in ('sale','sale_reversal')), 0),
         -coalesce(sum(t.quantity) filter (where t.txn_date between p_start and p_end
                  and t.transaction_type in ('damaged','expired','spoiled','missing')), 0),
         coalesce(sum(t.quantity) filter (where t.txn_date between p_start and p_end
                  and t.transaction_type in ('count_correction','other_adjustment')), 0),
         coalesce(sum(t.quantity) filter (where t.txn_date <= p_end), 0),
         i.quantity_on_hand,
         coalesce(sum(t.quantity), 0),
         coalesce(sum(t.quantity), 0) = i.quantity_on_hand,
         i.unit_cost, i.stock_value, i.reorder_level,
         public.stock_status(i.quantity_on_hand, i.reorder_level), i.is_active
  from public.inventory_items i
  left join public.inventory_categories c on c.id = i.category_id
  left join public.inventory_transactions t on t.item_id = i.id
  where not i.is_consigned
  group by i.id, c.name
  order by i.name
$$;

-- Alerts: consigned items never raise stock / expiry alerts.
create or replace function public.get_alerts()
returns table (alert_key text, severity text, category text, title text, message text, link text, occurred_on date)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  st public.school_settings;
  v_today date := public.today_ph();
  v_first_sale date;
  v_sy public.school_years;
begin
  if not public.is_active_user() then
    return;
  end if;
  select * into st from public.school_settings where id = 1;

  return query
  select 'out:' || i.id, 'critical', 'inventory', 'Out of stock: ' || i.name,
         i.name || ' has ' || trim_scale(i.quantity_on_hand) || ' ' || i.unit || ' on hand.',
         '/inventory/' || i.id, v_today
  from public.inventory_items i
  where i.is_active and not i.is_consigned and i.quantity_on_hand <= 0
  order by i.name;

  return query
  select 'low:' || i.id || ':' || i.quantity_on_hand, 'warning', 'inventory', 'Low stock: ' || i.name,
         trim_scale(i.quantity_on_hand) || ' ' || i.unit || ' left (reorder level ' || trim_scale(i.reorder_level) || ').',
         '/inventory/' || i.id, v_today
  from public.inventory_items i
  where i.is_active and not i.is_consigned and i.quantity_on_hand > 0 and i.quantity_on_hand <= i.reorder_level
  order by i.quantity_on_hand / nullif(i.reorder_level, 0);

  if st.expiration_tracking then
    return query
    select 'exp:' || i.id || ':' || i.expiration_date,
           case when i.expiration_date < v_today then 'critical' else 'warning' end, 'inventory',
           case when i.expiration_date < v_today then 'Expired: ' else 'Expiring soon: ' end || i.name,
           trim_scale(i.quantity_on_hand) || ' ' || i.unit || ' — expiry ' || to_char(i.expiration_date, 'Mon DD, YYYY') || '.',
           '/inventory/' || i.id, i.expiration_date
    from public.inventory_items i
    where i.is_active and not i.is_consigned and i.quantity_on_hand > 0 and i.expiration_date is not null
      and i.expiration_date <= v_today + st.expiry_warning_days;
  end if;

  return query
  select 'adj:' || t.id, case when t.is_exception then 'critical' else 'warning' end, 'inventory',
         case when t.is_exception then 'Negative-stock exception: ' else 'Unusual adjustment: ' end || i.name,
         initcap(replace(t.transaction_type::text, '_', ' ')) || ' of ' || trim_scale(t.quantity) || ' ' || i.unit ||
           ' (₱' || to_char(abs(t.quantity) * coalesce(t.unit_cost, 0), 'FM999,999,990.00') || ') by ' ||
           coalesce(p.full_name, 'unknown') || ' — ' || coalesce(t.reason, ''),
         '/inventory/' || i.id, t.txn_date
  from public.inventory_transactions t
  join public.inventory_items i on i.id = t.item_id
  left join public.profiles p on p.id = t.created_by
  where t.created_at >= now() - interval '14 days'
    and (t.is_exception or (
      t.transaction_type in ('damaged','expired','spoiled','missing','count_correction','other_adjustment')
      and (abs(t.quantity) * coalesce(t.unit_cost, 0) >= st.unusual_adjustment_value
           or (t.balance_before > 0 and abs(t.quantity) * 100 / t.balance_before >= st.unusual_adjustment_pct))));

  return query
  select 'recon:' || i.id, 'critical', 'discrepancy', 'Stock ledger mismatch: ' || i.name,
         'Quantity on hand (' || trim_scale(i.quantity_on_hand) || ') differs from the movement history (' ||
           trim_scale(coalesce(l.total, 0)) || ').', '/inventory/' || i.id, v_today
  from public.inventory_items i
  left join (select item_id, sum(quantity) as total from public.inventory_transactions group by item_id) l on l.item_id = i.id
  where i.quantity_on_hand <> coalesce(l.total, 0);

  return query
  select 'draft:' || d.id, 'warning', 'daily_sales', 'Daily sales not finalized',
         'The record for ' || to_char(d.sale_date, 'FMMonth DD, YYYY') || ' is still a draft.',
         '/daily-sales/' || d.id, d.sale_date
  from public.daily_sales d
  where d.status = 'draft' and d.sale_date < v_today;

  select min(sale_date) into v_first_sale from public.daily_sales;
  select * into v_sy from public.school_years where is_active;
  if v_first_sale is not null then
    return query
    select 'missing:' || g.d::date, 'info', 'daily_sales', 'No daily sales record',
           'No daily sales were recorded for ' || to_char(g.d, 'FMDay, FMMonth DD, YYYY') || '.',
           '/daily-sales/new?date=' || to_char(g.d, 'YYYY-MM-DD'), g.d::date
    from generate_series(greatest(v_today - st.missing_sales_lookback_days, v_first_sale,
                                  coalesce(v_sy.start_date, v_first_sale)),
                         v_today - 1, interval '1 day') as g(d)
    where extract(isodow from g.d)::smallint = any(st.school_days)
      and (v_sy.id is null or g.d::date <= v_sy.end_date)
      and not exists (select 1 from public.daily_sales d where d.sale_date = g.d::date)
    order by g.d desc;
  end if;

  if st.cash_variance_basis <> 'disabled' then
    return query
    select 'cash:' || r.report_date, 'warning', 'discrepancy', 'Cash variance on ' || to_char(r.report_date, 'Mon DD'),
           'Actual money ₱' || to_char(r.actual_money, 'FM999,999,990.00') || ' vs expected ₱' ||
             to_char(x.expected, 'FM999,999,990.00') || ' (difference ₱' ||
             to_char(r.actual_money - x.expected, 'FM999,999,990.00') || ').',
           '/reports?tab=consolidated', r.report_date
    from public.report_daily_summary(v_today - 31, v_today) r
    cross join lateral (select case st.cash_variance_basis
        when 'sales_amount' then r.sales_amount
        else r.sales_amount + r.other_shares - r.expenses - r.deficit end as expected) x
    where r.actual_money is not null and r.has_daily_sale and r.actual_money <> x.expected;
  end if;

  return query
  select 'fund:' || f.id, 'critical', 'discrepancy', 'Negative fund balance: ' || f.name,
         'Balance is ₱' || to_char(public.fund_balance(f.id), 'FM999,999,990.00') || '.', '/funds', v_today
  from public.fund_categories f
  where public.fund_balance(f.id) < 0;

  if st.formula_confirmed_at is null then
    return query select 'formula', 'info', 'settings', 'Confirm the financial reporting formula',
      'Net Sales = Gross − Expenses' || case when st.deduct_deficit_in_net then ' − Deficit' else '' end ||
      '; canteen share ₱' || st.canteen_share_rate || ' per unit. Review and confirm in Settings.',
      '/settings?tab=financial', v_today;
  end if;
  return query
  select 'rule:' || r.id, 'info', 'funds', 'Confirm fund allocation rule',
         '"' || r.name || '" (effective ' || to_char(r.effective_from, 'Mon DD, YYYY') || ') has not been confirmed by an administrator.',
         '/funds?tab=rules', v_today
  from public.allocation_rules r where r.status = 'active' and r.confirmed_at is null;

  if public.has_permission('import.run') then
    return query
    select 'import:' || b.id, 'info', 'import', 'Import awaiting review',
           count(*) || ' row(s) from ' || b.file_name || ' (' || b.sheet_name || ') need review.',
           '/settings/import?batch=' || b.id, b.created_at::date
    from public.import_batches b join public.import_rows r on r.batch_id = b.id
    where b.status = 'staged' and r.status in ('review', 'invalid')
    group by b.id;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Bulk product list (e.g. derived from the DAILY SALES sheet)
-- rows: [{ name, consignee, selling_price, unit_cost?, unit?, category?, is_consigned }]
-- Re-running it never duplicates: an existing item with the same name and
-- consignee is skipped.
-- ---------------------------------------------------------------------
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_consignee uuid;
  v_name text;
  v_cname text;
  v_consigned boolean;
  v_created int := 0;
  v_skipped int := 0;
  v_new_consignees int := 0;
begin
  perform public.require_permission('inventory.manage');
  perform public.set_audit_context('Product list import');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_name := trim(r ->> 'name');
    v_cname := nullif(trim(r ->> 'consignee'), '');
    v_consigned := coalesce((r ->> 'is_consigned')::boolean, v_cname is not null);
    if v_name is null or v_name = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_consignee := null;
    if v_cname is not null then
      select id into v_consignee from public.consignees where lower(trim(name)) = lower(v_cname);
      if v_consignee is null then
        insert into public.consignees (name, created_by) values (v_cname, auth.uid()) returning id into v_consignee;
        v_new_consignees := v_new_consignees + 1;
      end if;
    end if;
    if exists (select 1 from public.inventory_items
               where lower(trim(name)) = lower(v_name)
                 and coalesce(consignee_id::text, lower(coalesce(default_consignee, ''))) =
                     coalesce(v_consignee::text, lower(coalesce(v_cname, '')))) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    perform public.create_inventory_item(jsonb_build_object(
      'name', v_name,
      'item_code', '',
      'unit', coalesce(nullif(r ->> 'unit', ''), 'piece'),
      'selling_price', coalesce((r ->> 'selling_price')::numeric, 0),
      'unit_cost', coalesce((r ->> 'unit_cost')::numeric, 0),
      'category_id', (select id from public.inventory_categories where lower(name) = lower(r ->> 'category')),
      'is_consigned', v_consigned and v_consignee is not null,
      'consignee_id', case when v_consigned then v_consignee end,
      'default_consignee', v_cname));
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'new_consignees', v_new_consignees);
end
$$;

revoke execute on function public.next_item_code(boolean) from public, anon;
revoke execute on function public.import_products(jsonb) from public, anon;
grant execute on function public.import_products(jsonb) to authenticated;
revoke execute on function public._apply_stock(uuid, public.inv_txn_type, numeric, numeric, text, uuid, text, date, boolean, uuid) from public, anon, authenticated;
