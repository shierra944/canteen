-- =====================================================================
-- Migration 11: delete a whole day of daily sales, or a single expense /
-- other sale / deficit entry.
--
-- Deleted records leave every computation (they are removed from their
-- tables). A snapshot of what was deleted, who deleted it and why is kept
-- in the audit log. Stock that a finalized day deducted is put back with
-- an auditable sale_reversal, exactly like reopening a day.
-- =====================================================================

create or replace function public.delete_daily_sale(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.daily_sales;
  v_line record;
  v_snapshot jsonb;
begin
  perform public.require_permission('sales.correct');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason for deleting is required.';
  end if;
  select * into v_sale from public.daily_sales where id = p_id for update;
  if v_sale.id is null then raise exception 'Daily sales record not found.'; end if;

  v_snapshot := public.daily_sale_snapshot(p_id);
  perform public.set_audit_context(p_reason);

  -- put back any stock this day deducted
  for v_line in
    select i.* from public.daily_sale_items i
     where i.daily_sale_id = p_id and i.posted_txn_id is not null
     order by i.inventory_item_id, i.line_no
  loop
    perform public._apply_stock(
      v_line.inventory_item_id, 'sale_reversal', v_line.sold_quantity, null,
      'daily_sale_item', v_line.id, 'Deleted daily sales ' || to_char(v_sale.sale_date, 'YYYY-MM-DD') || ': ' || p_reason,
      v_sale.sale_date, false, v_line.posted_txn_id);
  end loop;

  perform public.log_audit('delete_daily_sale', 'daily_sales', p_id::text, v_snapshot, null, p_reason);
  delete from public.daily_sales where id = p_id; -- its lines go with it (on delete cascade)
end
$$;

create or replace function public.delete_financial_transaction(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_txn public.financial_transactions;
begin
  perform public.require_permission('finance.correct');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason for deleting is required.';
  end if;
  select * into v_txn from public.financial_transactions where id = p_id for update;
  if v_txn.id is null then raise exception 'Transaction not found.'; end if;
  if exists (select 1 from public.stock_receipts where expense_txn_id = p_id) then
    raise exception 'This expense was created by a stock receipt. Reverse the stock receipt instead.';
  end if;

  perform public.set_audit_context(p_reason);
  -- entries that corrected this one stay, but no longer point at it
  update public.financial_transactions set corrects_id = null where corrects_id = p_id;
  perform public.log_audit('delete_financial_transaction', 'financial_transactions', p_id::text, to_jsonb(v_txn), null, p_reason);
  delete from public.financial_transactions where id = p_id;
end
$$;

revoke execute on function public.delete_daily_sale(uuid, text) from public, anon;
revoke execute on function public.delete_financial_transaction(uuid, text) from public, anon;
grant execute on function public.delete_daily_sale(uuid, text) to authenticated;
grant execute on function public.delete_financial_transaction(uuid, text) to authenticated;
