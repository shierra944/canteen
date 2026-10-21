-- =====================================================================
-- Migration 3: business operations (atomic, permission-checked RPCs)
--
-- Every function that changes stock or money:
--   * checks permissions in the database (never trusts the UI)
--   * locks the rows it changes (SELECT ... FOR UPDATE) so concurrent
--     users cannot produce wrong balances
--   * writes an audit entry (via triggers + app.audit_context)
-- =====================================================================

-- Business "today" in the Philippines (DB clock is UTC).
create or replace function public.today_ph()
returns date
language sql stable
as $$
  select (now() at time zone 'Asia/Manila')::date
$$;

create or replace function public.set_audit_context(p_context text)
returns void
language sql
as $$
  select set_config('app.audit_context', coalesce(p_context, ''), true)
$$;

-- Audit trigger reads the optional context (reason) for this transaction.
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_old jsonb default null, p_new jsonb default null, p_context text default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, old_values, new_values, context)
  values (auth.uid(),
          (select full_name from public.profiles where id = auth.uid()),
          p_action, p_entity_type, p_entity_id, p_old, p_new,
          coalesce(p_context, nullif(current_setting('app.audit_context', true), '')));
end
$$;

create or replace function public.set_updated_by()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end
$$;

create trigger inventory_items_updated_by before update on public.inventory_items
  for each row execute function public.set_updated_by();

-- =====================================================================
-- INVENTORY
-- =====================================================================

-- The ONLY code path that changes inventory_items.quantity_on_hand.
create or replace function public._apply_stock(
  p_item_id uuid,
  p_type public.inv_txn_type,
  p_quantity numeric,            -- signed
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
  v_initial numeric := coalesce((p ->> 'initial_quantity')::numeric, 0);
  v_default_reorder numeric;
begin
  perform public.require_permission('inventory.manage');
  if v_initial < 0 then
    raise exception 'Initial stock cannot be negative.';
  end if;
  select default_reorder_level into v_default_reorder from public.school_settings where id = 1;

  begin
    insert into public.inventory_items (
      item_code, name, category_id, unit, unit_cost, selling_price, reorder_level,
      supplier_id, expiration_date, description, default_consignee, created_by, updated_by)
    values (
      upper(trim(p ->> 'item_code')), trim(p ->> 'name'), nullif(p ->> 'category_id', '')::uuid,
      trim(p ->> 'unit'), coalesce((p ->> 'unit_cost')::numeric, 0), coalesce((p ->> 'selling_price')::numeric, 0),
      coalesce((p ->> 'reorder_level')::numeric, v_default_reorder),
      nullif(p ->> 'supplier_id', '')::uuid, nullif(p ->> 'expiration_date', '')::date,
      nullif(trim(p ->> 'description'), ''), nullif(trim(p ->> 'default_consignee'), ''),
      auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Item code "%" is already used by another item.', upper(trim(p ->> 'item_code'));
  end;

  if v_initial > 0 then
    perform public._apply_stock(v_id, 'opening', v_initial, coalesce((p ->> 'unit_cost')::numeric, 0),
                                'item_create', v_id, 'Initial stock on item creation', public.today_ph());
  end if;
  return v_id;
end
$$;

create or replace function public.record_stock_in(p jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_key uuid := nullif(p ->> 'idempotency_key', '')::uuid;
  v_receipt public.stock_receipts;
  v_txn uuid;
  v_expense uuid;
  v_item public.inventory_items;
  v_supplier text;
begin
  perform public.require_permission('inventory.stock_in');

  if v_key is not null then
    select * into v_receipt from public.stock_receipts where idempotency_key = v_key;
    if v_receipt.id is not null then
      return v_receipt.id; -- duplicate submission: already recorded
    end if;
  end if;

  if (p ->> 'date_received')::date > public.today_ph() then
    raise exception 'Date received cannot be in the future.';
  end if;

  select * into v_item from public.inventory_items where id = (p ->> 'item_id')::uuid;
  if v_item.id is null or not v_item.is_active then
    raise exception 'Select an active inventory item.';
  end if;

  insert into public.stock_receipts (
    item_id, quantity, unit_cost, supplier_id, date_received, reference_no, remarks, idempotency_key, created_by)
  values (
    v_item.id, (p ->> 'quantity')::numeric, (p ->> 'unit_cost')::numeric, nullif(p ->> 'supplier_id', '')::uuid,
    (p ->> 'date_received')::date, nullif(trim(p ->> 'reference_no'), ''), nullif(trim(p ->> 'remarks'), ''),
    v_key, auth.uid())
  returning * into v_receipt;

  v_txn := public._apply_stock(v_item.id, 'stock_in', v_receipt.quantity, v_receipt.unit_cost,
                               'stock_receipt', v_receipt.id,
                               coalesce(v_receipt.remarks, 'Stock received') ||
                                 coalesce(' (Ref ' || v_receipt.reference_no || ')', ''),
                               v_receipt.date_received);

  -- Optional: record the purchase as a canteen expense (explicit opt-in,
  -- source-linked so it can never be counted twice).
  if coalesce((p ->> 'record_as_expense')::boolean, false) then
    perform public.require_permission('finance.record');
    select name into v_supplier from public.suppliers where id = v_receipt.supplier_id;
    insert into public.financial_transactions (
      transaction_date, transaction_type, category_id, description, requested_by, amount,
      reference_number, remarks, source_type, source_id, created_by, updated_by)
    values (
      v_receipt.date_received, 'expense',
      (select id from public.financial_categories where transaction_type = 'expense' and name = 'Stock Purchases'),
      'Stock purchase: ' || v_item.name || ' × ' || trim_scale(v_receipt.quantity),
      coalesce(v_supplier, 'Supplier'), v_receipt.total_cost, v_receipt.reference_no,
      'Auto-linked to stock receipt #' || v_receipt.receipt_no, 'stock_receipt', v_receipt.id,
      auth.uid(), auth.uid())
    returning id into v_expense;
  end if;

  update public.stock_receipts set inventory_txn_id = v_txn, expense_txn_id = v_expense where id = v_receipt.id;

  if v_receipt.supplier_id is not null and v_item.supplier_id is null then
    update public.inventory_items set supplier_id = v_receipt.supplier_id where id = v_item.id;
  end if;
  return v_receipt.id;
end
$$;

create or replace function public.reverse_stock_in(p_receipt_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.stock_receipts;
begin
  perform public.require_permission('inventory.adjust');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to reverse a stock receipt.';
  end if;
  select * into v_receipt from public.stock_receipts where id = p_receipt_id for update;
  if v_receipt.id is null then raise exception 'Stock receipt not found.'; end if;
  if v_receipt.status <> 'posted' then raise exception 'This stock receipt has already been reversed.'; end if;

  perform public.set_audit_context(p_reason);
  perform public._apply_stock(v_receipt.item_id, 'stock_in_reversal', -v_receipt.quantity, v_receipt.unit_cost,
                              'stock_receipt', v_receipt.id, 'Reversal: ' || p_reason, public.today_ph(),
                              false, v_receipt.inventory_txn_id);
  update public.stock_receipts
     set status = 'reversed', reversal_reason = p_reason, reversed_by = auth.uid(), reversed_at = now()
   where id = v_receipt.id;
  if v_receipt.expense_txn_id is not null then
    update public.financial_transactions
       set status = 'reversed', reversal_reason = 'Stock receipt reversed: ' || p_reason,
           reversed_by = auth.uid(), reversed_at = now(), updated_by = auth.uid()
     where id = v_receipt.expense_txn_id and status = 'posted';
  end if;
end
$$;

create or replace function public.adjust_stock(
  p_item_id uuid,
  p_type public.inv_txn_type,
  p_quantity numeric,
  p_reason text,
  p_allow_negative boolean default false,
  p_idempotency_key uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items;
  v_delta numeric;
  v_permitted text[];
  v_existing uuid;
  v_txn uuid;
begin
  perform public.require_permission('inventory.adjust');
  select permitted_adjustments into v_permitted from public.school_settings where id = 1;
  if not (p_type::text = any(v_permitted)) then
    raise exception 'Adjustment type "%" is not permitted by the inventory settings.', p_type;
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'An adjustment reason is required.';
  end if;

  -- lock the item first so the idempotency check and count are race-free
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'Inventory item not found.'; end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.inventory_transactions
     where reference_type = 'adjustment' and reference_id = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;

  if p_type in ('damaged', 'expired', 'spoiled', 'missing') then
    if p_quantity is null or p_quantity <= 0 then
      raise exception 'Enter the quantity removed (greater than zero).';
    end if;
    v_delta := -p_quantity;
  elsif p_type = 'count_correction' then
    if p_quantity is null or p_quantity < 0 then
      raise exception 'Enter the physical count (zero or more).';
    end if;
    v_delta := p_quantity - v_item.quantity_on_hand;
    if v_delta = 0 then
      raise exception 'The physical count matches the system quantity; no correction needed.';
    end if;
  elsif p_type = 'other_adjustment' then
    if p_quantity is null or p_quantity = 0 then
      raise exception 'Enter a non-zero adjustment quantity (negative to remove stock).';
    end if;
    v_delta := p_quantity;
  else
    raise exception 'Unsupported adjustment type.';
  end if;

  v_txn := public._apply_stock(p_item_id, p_type, v_delta, null, 'adjustment', p_idempotency_key,
                               p_reason, public.today_ph(), p_allow_negative);
  perform public.log_audit('adjust_inventory', 'inventory_items', p_item_id::text,
    jsonb_build_object('quantity_on_hand', v_item.quantity_on_hand),
    jsonb_build_object('quantity_on_hand', v_item.quantity_on_hand + v_delta, 'type', p_type, 'change', v_delta),
    p_reason);
  return v_txn;
end
$$;

-- =====================================================================
-- DAILY SALES
-- =====================================================================
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
    if v_total < 0 or v_sold < 0 or v_share < 0 or v_price < 0 then
      raise exception 'Line % (%): quantities and prices cannot be negative.', v_no, v_name;
    end if;
    if v_sold > v_total then
      raise exception 'Line % (%): sold quantity (%) exceeds total quantity (%).',
        v_no, v_name, trim_scale(v_sold), trim_scale(v_total);
    end if;
    insert into public.daily_sale_items (
      daily_sale_id, line_no, inventory_item_id, item_name_snapshot, unit_snapshot, consignee,
      total_quantity, unit_price, sold_quantity, share_quantity)
    values (
      v_sale.id, v_no, v_item.id, v_name, coalesce(v_item.unit, nullif(v_line ->> 'unit', '')),
      nullif(trim(v_line ->> 'consignee'), ''), v_total, v_price, v_sold, v_share);
  end loop;

  return jsonb_build_object('id', v_sale.id, 'version', v_sale.version);
end
$$;

create or replace function public.daily_sale_snapshot(p_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'sale_date', d.sale_date, 'status', d.status, 'actual_money', d.actual_money, 'share_rate', d.share_rate,
    'total_sales_amount', (select coalesce(sum(sales_amount), 0) from public.daily_sale_items where daily_sale_id = d.id),
    'total_sold', (select coalesce(sum(sold_quantity), 0) from public.daily_sale_items where daily_sale_id = d.id),
    'total_share', (select coalesce(sum(share_quantity), 0) from public.daily_sale_items where daily_sale_id = d.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'line_no', line_no, 'item', item_name_snapshot, 'consignee', consignee,
                'total', total_quantity, 'price', unit_price, 'sold', sold_quantity, 'share', share_quantity)
                order by line_no), '[]'::jsonb)
              from public.daily_sale_items where daily_sale_id = d.id))
  from public.daily_sales d where d.id = p_id
$$;

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

  -- Deduct inventory exactly once per line (posted_txn_id marks it).
  -- Lines are processed in item order so concurrent finalizations lock
  -- inventory rows in the same order (no deadlocks).
  if v_sale.source = 'manual' then
    for v_line in
      select i.* from public.daily_sale_items i
       where i.daily_sale_id = p_id and i.inventory_item_id is not null
         and i.sold_quantity > 0 and i.posted_txn_id is null
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
         share_rate = coalesce(share_rate, v_rate),   -- keep the original rate after a correction
         finalized_by = auth.uid(), finalized_at = now(),
         inventory_posted = (source = 'manual'),
         version = version + 1, updated_by = auth.uid()
   where id = p_id;

  perform public.log_audit('finalize_daily_sale', 'daily_sales', p_id::text, null,
                           public.daily_sale_snapshot(p_id), p_exception_reason);
end
$$;

create or replace function public.reopen_daily_sale(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.daily_sales;
  v_line record;
  v_before jsonb;
begin
  perform public.require_permission('sales.correct');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A correction reason is required.';
  end if;
  select * into v_sale from public.daily_sales where id = p_id for update;
  if v_sale.id is null then raise exception 'Daily sales record not found.'; end if;
  if v_sale.status <> 'finalized' then raise exception 'Only finalized records can be reopened.'; end if;

  v_before := public.daily_sale_snapshot(p_id);
  perform public.set_audit_context(p_reason);

  -- Auditable reversal of every inventory deduction made at finalization.
  for v_line in
    select i.* from public.daily_sale_items i
     where i.daily_sale_id = p_id and i.posted_txn_id is not null
     order by i.inventory_item_id, i.line_no
  loop
    perform public._apply_stock(
      v_line.inventory_item_id, 'sale_reversal', v_line.sold_quantity, null,
      'daily_sale_item', v_line.id, 'Correction of daily sales ' || to_char(v_sale.sale_date, 'YYYY-MM-DD') || ': ' || p_reason,
      v_sale.sale_date, false, v_line.posted_txn_id);
    update public.daily_sale_items set posted_txn_id = null where id = v_line.id;
  end loop;

  update public.daily_sales
     set status = 'draft', finalized_at = null, finalized_by = null, inventory_posted = false,
         correction_count = correction_count + 1, version = version + 1, updated_by = auth.uid()
   where id = p_id;

  perform public.log_audit('reopen_daily_sale', 'daily_sales', p_id::text, v_before, null, p_reason);
end
$$;

create or replace function public.delete_daily_sale_draft(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.daily_sales;
begin
  perform public.require_permission('sales.record');
  select * into v_sale from public.daily_sales where id = p_id for update;
  if v_sale.id is null then raise exception 'Daily sales record not found.'; end if;
  if v_sale.status <> 'draft' or v_sale.correction_count > 0 or v_sale.source <> 'manual' then
    raise exception 'Only never-finalized drafts can be deleted. Corrected records keep their history.';
  end if;
  perform public.log_audit('delete_daily_sale_draft', 'daily_sales', p_id::text, public.daily_sale_snapshot(p_id), null);
  delete from public.daily_sales where id = p_id;
end
$$;

-- =====================================================================
-- EXPENSES, OTHER SALES & DEFICITS
-- =====================================================================
create or replace function public._validate_fin_category(p_category uuid, p_type public.fin_txn_type)
returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if p_category is not null and not exists (
      select 1 from public.financial_categories where id = p_category and transaction_type = p_type) then
    raise exception 'The selected category does not belong to the % transaction type.', p_type;
  end if;
end
$$;

create or replace function public.create_financial_transaction(p jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_key uuid := nullif(p ->> 'idempotency_key', '')::uuid;
  v_id uuid;
  v_type public.fin_txn_type := (p ->> 'transaction_type')::public.fin_txn_type;
  v_date date := (p ->> 'transaction_date')::date;
begin
  perform public.require_permission('finance.record');
  if v_key is not null then
    select id into v_id from public.financial_transactions where idempotency_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;
  if v_date is null then raise exception 'Transaction date is required.'; end if;
  if v_date > public.today_ph() then raise exception 'Transaction date cannot be in the future.'; end if;
  perform public._validate_fin_category(nullif(p ->> 'category_id', '')::uuid, v_type);

  insert into public.financial_transactions (
    transaction_date, transaction_type, category_id, description, requested_by, amount,
    payment_method, reference_number, remarks, included_in_daily_sales, idempotency_key,
    created_by, updated_by)
  values (
    v_date, v_type, nullif(p ->> 'category_id', '')::uuid, trim(p ->> 'description'),
    nullif(trim(p ->> 'requested_by'), ''), (p ->> 'amount')::numeric,
    nullif(trim(p ->> 'payment_method'), ''), nullif(trim(p ->> 'reference_number'), ''),
    nullif(trim(p ->> 'remarks'), ''),
    v_type = 'sale' and coalesce((p ->> 'included_in_daily_sales')::boolean, false),
    v_key, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  if v_key is not null then
    select id into v_id from public.financial_transactions where idempotency_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;
  raise;
end
$$;

-- Own same-day entries can be fixed by the recorder; anything else needs
-- finance.correct and a reason.
create or replace function public._can_correct_fin(v public.financial_transactions)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select public.has_permission('finance.correct')
      or (public.has_permission('finance.record')
          and v.created_by = auth.uid()
          and (v.created_at at time zone 'Asia/Manila')::date = public.today_ph())
$$;

create or replace function public.update_financial_transaction(
  p_id uuid, p jsonb, p_reason text default null, p_expected_version integer default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v public.financial_transactions;
  v_type public.fin_txn_type;
  v_date date;
begin
  select * into v from public.financial_transactions where id = p_id for update;
  if v.id is null then raise exception 'Transaction not found.'; end if;
  if not public._can_correct_fin(v) then
    raise exception 'You can only edit your own entries on the day they were recorded. Ask an administrator for a correction.'
      using errcode = '42501';
  end if;
  if v.status <> 'posted' then raise exception 'Reversed transactions cannot be edited.'; end if;
  if v.source_type = 'stock_receipt' then
    raise exception 'This expense is linked to a stock receipt. Reverse the stock receipt instead.';
  end if;
  if p_expected_version is not null and p_expected_version <> v.version then
    raise exception 'This transaction was changed by another user. Reload to see the latest version.' using errcode = '40001';
  end if;
  if not (v.created_by = auth.uid() and (v.created_at at time zone 'Asia/Manila')::date = public.today_ph())
     and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A correction reason is required.';
  end if;

  v_type := coalesce((p ->> 'transaction_type')::public.fin_txn_type, v.transaction_type);
  v_date := coalesce((p ->> 'transaction_date')::date, v.transaction_date);
  if v_date > public.today_ph() then raise exception 'Transaction date cannot be in the future.'; end if;
  perform public._validate_fin_category(
    case when p ? 'category_id' then nullif(p ->> 'category_id', '')::uuid else v.category_id end, v_type);

  perform public.set_audit_context(coalesce(nullif(trim(p_reason), ''), 'Same-day edit by recorder'));
  update public.financial_transactions set
    transaction_date = v_date,
    transaction_type = v_type,
    category_id = case when p ? 'category_id' then nullif(p ->> 'category_id', '')::uuid else category_id end,
    description = coalesce(nullif(trim(p ->> 'description'), ''), description),
    requested_by = case when p ? 'requested_by' then nullif(trim(p ->> 'requested_by'), '') else requested_by end,
    amount = coalesce((p ->> 'amount')::numeric, amount),
    payment_method = case when p ? 'payment_method' then nullif(trim(p ->> 'payment_method'), '') else payment_method end,
    reference_number = case when p ? 'reference_number' then nullif(trim(p ->> 'reference_number'), '') else reference_number end,
    remarks = case when p ? 'remarks' then nullif(trim(p ->> 'remarks'), '') else remarks end,
    included_in_daily_sales = v_type = 'sale' and coalesce((p ->> 'included_in_daily_sales')::boolean, included_in_daily_sales),
    version = version + 1,
    updated_by = auth.uid()
  where id = p_id;
end
$$;

create or replace function public.reverse_financial_transaction(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v public.financial_transactions;
begin
  select * into v from public.financial_transactions where id = p_id for update;
  if v.id is null then raise exception 'Transaction not found.'; end if;
  if not public._can_correct_fin(v) then
    raise exception 'You do not have permission to reverse this transaction.' using errcode = '42501';
  end if;
  if v.status <> 'posted' then raise exception 'This transaction is already reversed.'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reversal reason is required.'; end if;
  perform public.set_audit_context(p_reason);
  update public.financial_transactions
     set status = 'reversed', reversal_reason = p_reason, reversed_by = auth.uid(), reversed_at = now(),
         updated_by = auth.uid(), version = version + 1
   where id = p_id;
end
$$;

create or replace function public.create_cash_carryover(p jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.require_permission('finance.correct');
  insert into public.cash_carryovers (entry_date, description, amount, remarks, created_by)
  values ((p ->> 'entry_date')::date, trim(p ->> 'description'), (p ->> 'amount')::numeric,
          nullif(trim(p ->> 'remarks'), ''), auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.reverse_cash_carryover(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('finance.correct');
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reversal reason is required.'; end if;
  perform public.set_audit_context(p_reason);
  update public.cash_carryovers
     set status = 'reversed', reversal_reason = p_reason, reversed_by = auth.uid(), reversed_at = now()
   where id = p_id and status = 'posted';
  if not found then raise exception 'Carry-over not found or already reversed.'; end if;
end
$$;

-- =====================================================================
-- SETTINGS & USERS
-- =====================================================================
create or replace function public.update_settings(p jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cur public.school_settings;
  n public.school_settings;
begin
  perform public.require_permission('settings.manage');
  select * into cur from public.school_settings where id = 1 for update;
  n := jsonb_populate_record(cur, p - array['id','updated_at','updated_by','formula_confirmed_at','formula_confirmed_by']);

  update public.school_settings set
    header_line1 = n.header_line1, header_line2 = n.header_line2, region = n.region, division = n.division,
    school_name = n.school_name, school_id_no = n.school_id_no, address = n.address, phone = n.phone,
    email = n.email, logo_url = n.logo_url,
    canteen_share_rate = n.canteen_share_rate, deduct_deficit_in_net = n.deduct_deficit_in_net,
    cash_variance_basis = n.cash_variance_basis, require_full_allocation = n.require_full_allocation,
    inventory_valuation = n.inventory_valuation, default_reorder_level = n.default_reorder_level,
    expiration_tracking = n.expiration_tracking, expiry_warning_days = n.expiry_warning_days,
    permitted_adjustments = n.permitted_adjustments,
    unusual_adjustment_value = n.unusual_adjustment_value, unusual_adjustment_pct = n.unusual_adjustment_pct,
    school_days = n.school_days, missing_sales_lookback_days = n.missing_sales_lookback_days,
    signatories = n.signatories, report_number_prefix = n.report_number_prefix,
    export_include_signatories = n.export_include_signatories, default_report_period = n.default_report_period,
    -- changing a reporting formula requires re-confirmation
    formula_confirmed_at = case when (n.canteen_share_rate, n.deduct_deficit_in_net, n.cash_variance_basis)
                                     is distinct from (cur.canteen_share_rate, cur.deduct_deficit_in_net, cur.cash_variance_basis)
                                then null else cur.formula_confirmed_at end,
    formula_confirmed_by = case when (n.canteen_share_rate, n.deduct_deficit_in_net, n.cash_variance_basis)
                                     is distinct from (cur.canteen_share_rate, cur.deduct_deficit_in_net, cur.cash_variance_basis)
                                then null else cur.formula_confirmed_by end,
    updated_by = auth.uid()
  where id = 1;
end
$$;

create or replace function public.confirm_financial_formula()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('settings.manage');
  update public.school_settings set formula_confirmed_at = now(), formula_confirmed_by = auth.uid(), updated_by = auth.uid()
   where id = 1;
end
$$;

create or replace function public.set_active_school_year(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('settings.manage');
  if not exists (select 1 from public.school_years where id = p_id) then
    raise exception 'School year not found.';
  end if;
  update public.school_years set is_active = false where is_active and id <> p_id;
  update public.school_years set is_active = true where id = p_id;
  -- re-tag records that fall inside the school year range
  update public.daily_sales set school_year_id = public.school_year_for(sale_date)
   where school_year_id is distinct from public.school_year_for(sale_date);
  update public.financial_transactions set school_year_id = public.school_year_for(transaction_date)
   where school_year_id is distinct from public.school_year_for(transaction_date);
end
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_full_name text,
  p_position text,
  p_role public.app_role,
  p_is_active boolean,
  p_permissions text[])
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.profiles;
  v_perm text;
begin
  perform public.require_permission('users.manage');
  select * into v_target from public.profiles where id = p_user_id for update;
  if v_target.id is null then raise exception 'User not found.'; end if;

  if not public.is_admin() and (v_target.role = 'admin' or p_role = 'admin') then
    raise exception 'Only administrators can manage administrator accounts.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and (p_role <> v_target.role or not p_is_active) then
    raise exception 'You cannot change your own role or deactivate your own account.';
  end if;
  if v_target.role = 'admin' and v_target.is_active and (p_role <> 'admin' or not p_is_active)
     and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'At least one active administrator must remain.';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         position = nullif(trim(p_position), ''),
         role = p_role, is_active = p_is_active
   where id = p_user_id;

  delete from public.user_permissions
   where user_id = p_user_id and not (permission = any(coalesce(p_permissions, '{}')));
  foreach v_perm in array coalesce(p_permissions, '{}') loop
    if not exists (select 1 from public.permissions where code = v_perm) then
      raise exception 'Unknown permission %.', v_perm;
    end if;
    if p_role = 'viewer' and (select is_write from public.permissions where code = v_perm) then
      continue; -- viewers can never hold write permissions
    end if;
    insert into public.user_permissions (user_id, permission, granted_by)
    values (p_user_id, v_perm, auth.uid())
    on conflict do nothing;
  end loop;
end
$$;

create or replace function public.log_password_reset(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('users.manage');
  perform public.log_audit('reset_password', 'profiles', p_user_id::text, null, null, 'Password reset by administrator');
end
$$;

create or replace function public.update_my_profile(p_full_name text, p_position text default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'Name is required.'; end if;
  update public.profiles set full_name = trim(p_full_name), position = nullif(trim(p_position), '')
   where id = auth.uid();
end
$$;
