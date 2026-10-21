-- =====================================================================
-- Migration 9
--  * Daily sales: products and consignees typed manually on the sheet are
--    saved automatically to the product / consignee lists on save.
--  * Spreadsheet sync: commit keeps a batch open while rows still need review.
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
  v_cname text;
  v_consignee uuid;
  v_total numeric;
  v_sold numeric;
  v_share numeric;
  v_price numeric;
  v_cost numeric;
  v_stock boolean;
  v_new_products integer := 0;
  v_new_consignees integer := 0;
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

  perform public.set_audit_context('Added from the daily sales sheet of ' || to_char(p_sale_date, 'YYYY-MM-DD'));

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_no := v_no + 1;
    v_item := null;
    v_consignee := null;
    if nullif(v_line ->> 'inventory_item_id', '') is not null then
      select * into v_item from public.inventory_items where id = (v_line ->> 'inventory_item_id')::uuid;
      if v_item.id is null then raise exception 'Line %: inventory item not found.', v_no; end if;
    end if;
    v_name := coalesce(nullif(trim(v_line ->> 'item_name'), ''), v_item.name);
    if v_name is null then raise exception 'Line %: item name is required.', v_no; end if;
    v_cname := nullif(trim(v_line ->> 'consignee'), '');
    v_total := coalesce((v_line ->> 'total_quantity')::numeric, 0);
    v_sold := coalesce((v_line ->> 'sold_quantity')::numeric, 0);
    v_price := coalesce((v_line ->> 'unit_price')::numeric, v_item.selling_price, 0);
    v_share := coalesce((v_line ->> 'share_quantity')::numeric, v_sold);

    -- New consignee typed on the sheet → add it to the consignee list
    if v_cname is not null and (v_item.id is null or v_item.is_consigned) then
      select id into v_consignee from public.consignees where lower(trim(name)) = lower(v_cname);
      if v_consignee is null then
        insert into public.consignees (name, created_by) values (v_cname, auth.uid()) returning id into v_consignee;
        v_new_consignees := v_new_consignees + 1;
      end if;
    end if;

    -- New product typed on the sheet (with a consignee) → save it as a consigned
    -- product, or link to the existing product with the same name + consignee.
    if v_item.id is null and v_consignee is not null then
      select * into v_item from public.inventory_items
       where lower(trim(name)) = lower(v_name) and consignee_id = v_consignee
       order by is_active desc, created_at
       limit 1;
      if v_item.id is null then
        insert into public.inventory_items (
          item_code, name, unit, unit_cost, selling_price, reorder_level, is_consigned, consignee_id,
          description, created_by, updated_by)
        values (
          public.next_item_code(true), v_name, 'piece',
          coalesce(nullif(v_line ->> 'cost_price', '')::numeric, 0), v_price, 0, true, v_consignee,
          'Added automatically from the daily sales sheet', auth.uid(), auth.uid())
        returning * into v_item;
        v_new_products := v_new_products + 1;
      elsif not v_item.is_active then
        update public.inventory_items set is_active = true where id = v_item.id returning * into v_item;
      end if;
    end if;

    v_stock := v_item.id is not null and not v_item.is_consigned;
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
      v_cname, v_total, v_price, v_sold, v_share, v_cost, coalesce(v_stock, false));
  end loop;

  return jsonb_build_object('id', v_sale.id, 'version', v_sale.version,
                            'new_products', v_new_products, 'new_consignees', v_new_consignees);
end
$$;

-- Commit what is valid; keep the batch open while rows still need review so
-- they can be fixed and committed later (used by spreadsheet sync).
create or replace function public.sync_commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  v_result := public.commit_import_batch(p_batch_id);
  if exists (select 1 from public.import_rows where batch_id = p_batch_id and status in ('review', 'invalid')) then
    update public.import_batches set status = 'staged', committed_at = null, committed_by = null where id = p_batch_id;
  end if;
  return v_result;
end
$$;

-- a staged batch may now contain imported rows: only open rows are editable
create or replace function public.update_import_row(p_row_id uuid, p_mapped jsonb, p_status text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.import_rows;
  v_target text;
begin
  perform public.require_permission('import.run');
  select r.* into v_row from public.import_rows r join public.import_batches b on b.id = r.batch_id
   where r.id = p_row_id and b.status = 'staged' for update of r;
  if v_row.id is null then raise exception 'Row not found or batch already committed.'; end if;
  if v_row.status = 'imported' then raise exception 'This row has already been imported.'; end if;
  if p_status not in ('valid','review','skipped') then raise exception 'Invalid status.'; end if;
  select target into v_target from public.import_batches where id = v_row.batch_id;
  update public.import_rows
     set mapped = coalesce(p_mapped, mapped),
         group_key = case when v_target = 'daily_sales' then coalesce(nullif(p_mapped ->> 'sale_date', ''), group_key) else group_key end,
         fingerprint = public._import_fingerprint(v_target, coalesce(p_mapped, mapped)),
         status = p_status,
         messages = messages || ('Reviewed by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'administrator'))::text
   where id = p_row_id;
end
$$;

revoke execute on function public.sync_commit_import_batch(uuid) from public, anon;
grant execute on function public.sync_commit_import_batch(uuid) to authenticated;

-- Duplicate check for repeated syncs: anything already imported (in any
-- batch, open or committed) or already present in the target table counts.
create or replace function public._import_row_duplicate(p_target text, p_mapped jsonb, p_fp text, p_batch uuid)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select case p_target
    when 'financial_transactions' then
      exists (select 1 from public.financial_transactions where import_fingerprint = p_fp)
    when 'cash_carryovers' then
      exists (select 1 from public.cash_carryovers where import_fingerprint = p_fp)
    when 'daily_sales' then
      exists (select 1 from public.daily_sales where sale_date = (p_mapped ->> 'sale_date')::date)
    when 'summary_reference' then
      exists (select 1 from public.historical_summary_references h join public.import_batches b on b.id = h.batch_id
              where h.report_date = (p_mapped ->> 'report_date')::date and b.status <> 'cancelled')
    else false
  end
  or exists (select 1 from public.import_rows r join public.import_batches b on b.id = r.batch_id
             where r.fingerprint = p_fp and r.batch_id <> p_batch
               and (r.status = 'imported' or (b.status = 'staged' and r.status in ('valid','review'))))
$$;
