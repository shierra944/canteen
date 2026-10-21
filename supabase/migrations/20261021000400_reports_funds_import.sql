-- =====================================================================
-- Migration 4: reporting, fund allocation, alerts, unified ledger, import
--
-- FINANCIAL REPORTING RULES (mirrors workbook SUMMARY sheet)
--   Daily Canteen Shares = Σ share_quantity × share_rate   (finalized daily sales)
--                          (workbook: SUMMARY!D = 'DAILY SALES'!J15 = SUM(SHARE))
--   Other Shares         = Σ posted 'sale' transactions NOT already included
--                          in a daily sales record
--   Gross Sales          = Daily Canteen Shares + Other Shares
--   Expenses             = Σ posted 'expense' transactions
--   Deficit              = Σ posted 'deficit' transactions (kept separate)
--   Net Sales            = Gross − Expenses − Deficit   (deficit deduction
--                          is configurable but applies to ALL dates alike)
-- =====================================================================

create or replace function public.stock_status(p_qty numeric, p_reorder numeric)
returns text
language sql immutable
as $$
  select case when p_qty <= 0 then 'out_of_stock'
              when p_qty <= p_reorder then 'low_stock'
              else 'in_stock' end
$$;

create view public.v_inventory_items with (security_invoker = true) as
select i.*,
       c.name as category_name,
       s.name as supplier_name,
       public.stock_status(i.quantity_on_hand, i.reorder_level) as stock_status
from public.inventory_items i
left join public.inventory_categories c on c.id = i.category_id
left join public.suppliers s on s.id = i.supplier_id;

create view public.v_daily_sales with (security_invoker = true) as
select d.*,
       coalesce(t.line_count, 0) as line_count,
       coalesce(t.total_quantity, 0) as total_quantity,
       coalesce(t.units_sold, 0) as units_sold,
       coalesce(t.sales_amount, 0) as sales_amount,
       coalesce(t.unsold_units, 0) as unsold_units,
       coalesce(t.unsold_amount, 0) as unsold_amount,
       coalesce(t.share_units, 0) as share_units,
       round(coalesce(t.share_units, 0) * coalesce(d.share_rate, st.canteen_share_rate), 2) as canteen_shares,
       pc.full_name as created_by_name,
       pf.full_name as finalized_by_name
from public.daily_sales d
cross join public.school_settings st
left join lateral (
  select count(*) as line_count, sum(total_quantity) as total_quantity, sum(sold_quantity) as units_sold,
         sum(sales_amount) as sales_amount, sum(unsold_quantity) as unsold_units,
         sum(unsold_amount) as unsold_amount, sum(share_quantity) as share_units
  from public.daily_sale_items i where i.daily_sale_id = d.id
) t on true
left join public.profiles pc on pc.id = d.created_by
left join public.profiles pf on pf.id = d.finalized_by;

create view public.v_financial_transactions with (security_invoker = true) as
select f.*,
       c.name as category_name,
       pc.full_name as created_by_name,
       pu.full_name as updated_by_name
from public.financial_transactions f
left join public.financial_categories c on c.id = f.category_id
left join public.profiles pc on pc.id = f.created_by
left join public.profiles pu on pu.id = f.updated_by;

-- ---------------------------------------------------------------------
-- Consolidated daily canteen report (workbook SUMMARY, left table)
-- ---------------------------------------------------------------------
create or replace function public.report_daily_summary(p_start date, p_end date)
returns table (
  report_date date,
  actual_money numeric,
  sales_amount numeric,
  units_sold numeric,
  share_units numeric,
  daily_canteen_shares numeric,
  other_shares numeric,
  gross_sales numeric,
  expenses numeric,
  deficit numeric,
  net_sales numeric,
  included_sales numeric,
  has_daily_sale boolean
)
language sql stable
set search_path = public, pg_temp
as $$
  with st as (select * from public.school_settings where id = 1),
  ds as (
    select v.sale_date as d, v.actual_money, v.sales_amount, v.units_sold, v.share_units, v.canteen_shares
    from public.v_daily_sales v
    where v.status = 'finalized' and v.sale_date between p_start and p_end
  ),
  ft as (
    select f.transaction_date as d,
           sum(f.amount) filter (where f.transaction_type = 'sale' and not f.included_in_daily_sales) as other_shares,
           sum(f.amount) filter (where f.transaction_type = 'sale' and f.included_in_daily_sales) as included_sales,
           sum(f.amount) filter (where f.transaction_type = 'expense') as expenses,
           sum(f.amount) filter (where f.transaction_type = 'deficit') as deficit
    from public.financial_transactions f
    where f.status = 'posted' and f.transaction_date between p_start and p_end
    group by f.transaction_date
  ),
  days as (select d from ds union select d from ft)
  select days.d,
         ds.actual_money,
         coalesce(ds.sales_amount, 0),
         coalesce(ds.units_sold, 0),
         coalesce(ds.share_units, 0),
         coalesce(ds.canteen_shares, 0),
         coalesce(ft.other_shares, 0),
         coalesce(ds.canteen_shares, 0) + coalesce(ft.other_shares, 0),
         coalesce(ft.expenses, 0),
         coalesce(ft.deficit, 0),
         coalesce(ds.canteen_shares, 0) + coalesce(ft.other_shares, 0) - coalesce(ft.expenses, 0)
           - case when st.deduct_deficit_in_net then coalesce(ft.deficit, 0) else 0 end,
         coalesce(ft.included_sales, 0),
         ds.d is not null
  from days
  cross join st
  left join ds on ds.d = days.d
  left join ft on ft.d = days.d
  order by days.d
$$;

create or replace function public.report_period_totals(p_start date, p_end date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'start', p_start, 'end', p_end,
    'days_reported', count(*),
    'actual_money', coalesce(sum(r.actual_money), 0),
    'sales_amount', coalesce(sum(r.sales_amount), 0),
    'units_sold', coalesce(sum(r.units_sold), 0),
    'share_units', coalesce(sum(r.share_units), 0),
    'daily_canteen_shares', coalesce(sum(r.daily_canteen_shares), 0),
    'other_shares', coalesce(sum(r.other_shares), 0),
    'gross_sales', coalesce(sum(r.gross_sales), 0),
    'expenses', coalesce(sum(r.expenses), 0),
    'deficit', coalesce(sum(r.deficit), 0),
    'net_sales', coalesce(sum(r.net_sales), 0),
    'included_sales', coalesce(sum(r.included_sales), 0),
    'carryover', (select coalesce(sum(amount), 0) from public.cash_carryovers
                   where status = 'posted' and entry_date between p_start and p_end))
  from public.report_daily_summary(p_start, p_end) r
$$;

-- Monthly canteen report (workbook SUMMARY, right table)
create or replace function public.report_monthly_summary(p_start date, p_end date)
returns table (
  month_start date,
  school_year text,
  days_reported bigint,
  actual_money numeric,
  daily_canteen_shares numeric,
  other_shares numeric,
  gross_sales numeric,
  expenses numeric,
  deficit numeric,
  net_sales numeric,
  sales_amount numeric
)
language sql stable
set search_path = public, pg_temp
as $$
  with m as (
    select date_trunc('month', r.report_date)::date as month_start,
           count(*) as days_reported,
           coalesce(sum(r.actual_money), 0) as actual_money,
           sum(r.daily_canteen_shares) as daily_canteen_shares, sum(r.other_shares) as other_shares,
           sum(r.gross_sales) as gross_sales, sum(r.expenses) as expenses, sum(r.deficit) as deficit,
           sum(r.net_sales) as net_sales, sum(r.sales_amount) as sales_amount,
           min(r.report_date) as first_day
    from public.report_daily_summary(p_start, p_end) r
    group by 1
  )
  select m.month_start,
         (select sy.name from public.school_years sy
           where m.first_day between sy.start_date and sy.end_date
           order by sy.start_date desc limit 1),
         m.days_reported, m.actual_money, m.daily_canteen_shares, m.other_shares, m.gross_sales,
         m.expenses, m.deficit, m.net_sales, m.sales_amount
  from m
  order by m.month_start
$$;

create or replace function public.dashboard_metrics(p_start date, p_end date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select public.report_period_totals(p_start, p_end) || jsonb_build_object(
    'inventory_value', (select coalesce(sum(stock_value), 0) from public.inventory_items where is_active),
    'inventory_valuation', (select inventory_valuation from public.school_settings where id = 1),
    'items_active', (select count(*) from public.inventory_items where is_active),
    'items_in_stock', (select count(*) from public.inventory_items
                        where is_active and public.stock_status(quantity_on_hand, reorder_level) = 'in_stock'),
    'items_low_stock', (select count(*) from public.inventory_items
                         where is_active and public.stock_status(quantity_on_hand, reorder_level) = 'low_stock'),
    'items_out_of_stock', (select count(*) from public.inventory_items
                            where is_active and public.stock_status(quantity_on_hand, reorder_level) = 'out_of_stock'),
    'draft_daily_sales', (select count(*) from public.daily_sales where status = 'draft'
                            and sale_date between p_start and p_end),
    'deduct_deficit_in_net', (select deduct_deficit_in_net from public.school_settings where id = 1),
    'formula_confirmed', (select formula_confirmed_at is not null from public.school_settings where id = 1)
  )
$$;

-- Expense breakdown by category for a period
create or replace function public.report_expense_breakdown(p_start date, p_end date)
returns table (transaction_type public.fin_txn_type, category text, total numeric, txn_count bigint)
language sql stable
set search_path = public, pg_temp
as $$
  select f.transaction_type, coalesce(c.name, 'Uncategorized'), sum(f.amount), count(*)
  from public.financial_transactions f
  left join public.financial_categories c on c.id = f.category_id
  where f.status = 'posted' and f.transaction_date between p_start and p_end
  group by 1, 2
  order by 1, 3 desc
$$;

-- ---------------------------------------------------------------------
-- Inventory movement (reconciles to quantity_on_hand)
-- ---------------------------------------------------------------------
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
  group by i.id, c.name
  order by i.name
$$;

-- ---------------------------------------------------------------------
-- FUNDS
-- ---------------------------------------------------------------------
create or replace function public.applicable_allocation_rule(p_date date)
returns public.allocation_rules
language sql stable
set search_path = public, pg_temp
as $$
  select * from public.allocation_rules
  where status = 'active' and effective_from <= p_date
  order by effective_from desc
  limit 1
$$;

create or replace function public.fund_balance(p_fund uuid, p_as_of date default null)
returns numeric
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount), 0) from public.fund_transactions
  where fund_category_id = p_fund and status = 'posted'
    and (p_as_of is null or transaction_date <= p_as_of)
$$;

create or replace function public.fund_summary(p_start date, p_end date)
returns table (
  fund_category_id uuid, code text, name text, sort_order integer, is_allocatable boolean,
  percentage numeric, opening_balance numeric, allocations numeric, expenditures numeric,
  adjustments numeric, closing_balance numeric, available numeric, utilization_pct numeric
)
language sql stable
set search_path = public, pg_temp
as $$
  with r as (select * from public.applicable_allocation_rule(p_end))
  select f.id, f.code, f.name, f.sort_order, f.is_allocatable,
         (select l.percentage from public.allocation_rule_lines l, r where l.rule_id = r.id and l.fund_category_id = f.id),
         coalesce(sum(t.amount) filter (where t.transaction_date < p_start), 0) as opening,
         coalesce(sum(t.amount) filter (where t.transaction_date between p_start and p_end and t.transaction_type = 'allocation'), 0),
         -coalesce(sum(t.amount) filter (where t.transaction_date between p_start and p_end and t.transaction_type = 'expenditure'), 0),
         coalesce(sum(t.amount) filter (where t.transaction_date between p_start and p_end
                  and t.transaction_type in ('opening','adjustment','reversal','allocation_reversal')), 0),
         coalesce(sum(t.amount) filter (where t.transaction_date <= p_end), 0),
         coalesce(sum(t.amount), 0),
         case when coalesce(sum(t.amount) filter (where t.transaction_date <= p_end and t.amount > 0), 0) = 0 then 0
              else round(100 * -coalesce(sum(t.amount) filter (where t.transaction_date <= p_end and t.transaction_type = 'expenditure'), 0)
                         / sum(t.amount) filter (where t.transaction_date <= p_end and t.amount > 0), 1) end
  from public.fund_categories f
  left join public.fund_transactions t on t.fund_category_id = f.id and t.status = 'posted'
  where f.is_active
  group by f.id
  order by f.sort_order
$$;

create or replace function public.preview_fund_allocation(p_start date, p_end date)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_rule public.allocation_rules;
  v_totals jsonb;
  v_base numeric;
  v_lines jsonb;
  v_allocated numeric;
  v_pct numeric;
  v_overlap jsonb;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid allocation period.';
  end if;
  v_rule := public.applicable_allocation_rule(p_start);
  v_totals := public.report_period_totals(p_start, p_end);
  if v_rule.id is null then
    return jsonb_build_object('rule', null, 'totals', v_totals, 'error',
      'No active allocation rule is effective on ' || p_start || '. Activate a rule first.');
  end if;

  v_base := case v_rule.basis
    when 'gross_sales' then (v_totals ->> 'gross_sales')::numeric
    when 'net_sales' then (v_totals ->> 'net_sales')::numeric
    when 'gross_plus_carryover' then (v_totals ->> 'gross_sales')::numeric + (v_totals ->> 'carryover')::numeric
    when 'net_plus_carryover' then (v_totals ->> 'net_sales')::numeric + (v_totals ->> 'carryover')::numeric
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fund_category_id', f.id, 'name', f.name, 'percentage', l.percentage,
           'amount', round(greatest(v_base, 0) * l.percentage / 100, 2)) order by f.sort_order), '[]'),
         coalesce(sum(round(greatest(v_base, 0) * l.percentage / 100, 2)), 0),
         coalesce(sum(l.percentage), 0)
    into v_lines, v_allocated, v_pct
  from public.allocation_rule_lines l
  join public.fund_categories f on f.id = l.fund_category_id
  where l.rule_id = v_rule.id;

  select coalesce(jsonb_agg(jsonb_build_object('run_no', run_no, 'period_start', period_start, 'period_end', period_end)), '[]')
    into v_overlap
  from public.fund_allocation_runs
  where status = 'posted' and period_start <= p_end and period_end >= p_start;

  return jsonb_build_object(
    'rule', jsonb_build_object('id', v_rule.id, 'name', v_rule.name, 'basis', v_rule.basis,
                               'effective_from', v_rule.effective_from, 'confirmed', v_rule.confirmed_at is not null),
    'totals', v_totals,
    'base_amount', v_base,
    'lines', v_lines,
    'total_percentage', v_pct,
    'allocated_total', v_allocated,
    'unallocated', greatest(v_base, 0) - v_allocated,
    'overlapping_runs', v_overlap);
end
$$;

create or replace function public.run_fund_allocation(p_start date, p_end date, p_remarks text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_preview jsonb;
  v_run uuid;
  v_line jsonb;
begin
  perform public.require_permission('funds.manage');
  -- serialize allocation runs so overlapping periods can never be allocated twice
  lock table public.fund_allocation_runs in share row exclusive mode;
  v_preview := public.preview_fund_allocation(p_start, p_end);
  if v_preview ? 'error' then raise exception '%', v_preview ->> 'error'; end if;
  if jsonb_array_length(v_preview -> 'overlapping_runs') > 0 then
    raise exception 'Part of this period has already been allocated (run #%). Reverse that run first.',
      v_preview -> 'overlapping_runs' -> 0 ->> 'run_no';
  end if;
  if (v_preview ->> 'base_amount')::numeric <= 0 then
    raise exception 'The allocation base for this period is ₱% — there is nothing to allocate.',
      to_char((v_preview ->> 'base_amount')::numeric, 'FM999,999,990.00');
  end if;

  insert into public.fund_allocation_runs (
    period_start, period_end, rule_id, basis, gross_sales, net_sales, carryover, base_amount,
    allocated_total, remarks, created_by)
  values (
    p_start, p_end, (v_preview -> 'rule' ->> 'id')::uuid,
    (v_preview -> 'rule' ->> 'basis')::public.allocation_basis,
    (v_preview -> 'totals' ->> 'gross_sales')::numeric, (v_preview -> 'totals' ->> 'net_sales')::numeric,
    (v_preview -> 'totals' ->> 'carryover')::numeric, (v_preview ->> 'base_amount')::numeric,
    (v_preview ->> 'allocated_total')::numeric, nullif(trim(p_remarks), ''), auth.uid())
  returning id into v_run;

  for v_line in select * from jsonb_array_elements(v_preview -> 'lines') loop
    if (v_line ->> 'amount')::numeric > 0 then
      insert into public.fund_transactions (
        fund_category_id, transaction_type, amount, transaction_date, allocation_run_id,
        percentage_applied, description, created_by)
      values (
        (v_line ->> 'fund_category_id')::uuid, 'allocation', (v_line ->> 'amount')::numeric, p_end, v_run,
        (v_line ->> 'percentage')::numeric,
        'Allocation ' || to_char(p_start, 'Mon DD, YYYY') || ' – ' || to_char(p_end, 'Mon DD, YYYY'),
        auth.uid());
    end if;
  end loop;
  return v_run;
end
$$;

create or replace function public.reverse_fund_allocation(p_run_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.fund_allocation_runs;
  v_fund record;
begin
  perform public.require_permission('funds.manage');
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reversal reason is required.'; end if;
  select * into v_run from public.fund_allocation_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'Allocation run not found.'; end if;
  if v_run.status <> 'posted' then raise exception 'This allocation run is already reversed.'; end if;

  -- refuse if a fund has already spent the money being withdrawn
  for v_fund in
    select t.fund_category_id, f.name, t.amount
    from public.fund_transactions t join public.fund_categories f on f.id = t.fund_category_id
    where t.allocation_run_id = p_run_id and t.status = 'posted'
    order by t.fund_category_id
  loop
    perform 1 from public.fund_categories where id = v_fund.fund_category_id for update;
    if public.fund_balance(v_fund.fund_category_id) - v_fund.amount < 0 then
      raise exception 'Cannot reverse: % has already used part of this allocation.', v_fund.name;
    end if;
  end loop;

  perform public.set_audit_context(p_reason);
  update public.fund_transactions
     set status = 'reversed', reversal_reason = p_reason, reversed_by = auth.uid(), reversed_at = now()
   where allocation_run_id = p_run_id and status = 'posted';
  update public.fund_allocation_runs
     set status = 'reversed', reversal_reason = p_reason, reversed_by = auth.uid(), reversed_at = now()
   where id = p_run_id;
end
$$;

create or replace function public.record_fund_transaction(p jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_key uuid := nullif(p ->> 'idempotency_key', '')::uuid;
  v_type public.fund_txn_type := (p ->> 'transaction_type')::public.fund_txn_type;
  v_amount numeric := (p ->> 'amount')::numeric;
  v_fund public.fund_categories;
  v_signed numeric;
  v_id uuid;
begin
  perform public.require_permission('funds.manage');
  if v_key is not null then
    select id into v_id from public.fund_transactions where idempotency_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;
  if v_type not in ('opening', 'expenditure', 'adjustment') then
    raise exception 'Use the allocation run to record allocations.';
  end if;
  if v_amount is null or v_amount = 0 then raise exception 'Enter a non-zero amount.'; end if;
  if (p ->> 'transaction_date')::date > public.today_ph() then raise exception 'Date cannot be in the future.'; end if;
  if v_type <> 'opening' and length(trim(coalesce(p ->> 'description', ''))) = 0 then
    raise exception 'A description is required.';
  end if;

  select * into v_fund from public.fund_categories where id = (p ->> 'fund_category_id')::uuid for update;
  if v_fund.id is null then raise exception 'Fund not found.'; end if;

  v_signed := case v_type when 'expenditure' then -abs(v_amount) when 'opening' then abs(v_amount) else v_amount end;
  if public.fund_balance(v_fund.id) + v_signed < 0 then
    raise exception 'Insufficient balance in %: available ₱%.', v_fund.name,
      to_char(public.fund_balance(v_fund.id), 'FM999,999,990.00');
  end if;

  insert into public.fund_transactions (
    fund_category_id, transaction_type, amount, transaction_date, description, reference_no, remarks,
    idempotency_key, created_by)
  values (
    v_fund.id, v_type, v_signed, (p ->> 'transaction_date')::date,
    coalesce(nullif(trim(p ->> 'description'), ''), 'Opening balance'),
    nullif(trim(p ->> 'reference_no'), ''), nullif(trim(p ->> 'remarks'), ''), v_key, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.reverse_fund_transaction(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v public.fund_transactions;
begin
  perform public.require_permission('funds.manage');
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reversal reason is required.'; end if;
  select * into v from public.fund_transactions where id = p_id for update;
  if v.id is null then raise exception 'Fund transaction not found.'; end if;
  if v.status <> 'posted' then raise exception 'Already reversed.'; end if;
  if v.allocation_run_id is not null then
    raise exception 'Allocation entries are reversed by reversing the whole allocation run.';
  end if;
  perform 1 from public.fund_categories where id = v.fund_category_id for update;
  if public.fund_balance(v.fund_category_id) - v.amount < 0 then
    raise exception 'Reversing this entry would make the fund balance negative.';
  end if;
  perform public.set_audit_context(p_reason);
  update public.fund_transactions
     set status = 'reversed', reversal_reason = p_reason, reversed_by = auth.uid(), reversed_at = now()
   where id = p_id;
end
$$;

create or replace function public.save_allocation_rule(p_id uuid, p jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_line jsonb;
begin
  perform public.require_permission('funds.manage');
  if (p ->> 'effective_from') is null then raise exception 'Effective date is required.'; end if;
  if v_id is null then
    insert into public.allocation_rules (name, effective_from, basis, notes, created_by)
    values (coalesce(nullif(trim(p ->> 'name'), ''), 'Allocation rule'), (p ->> 'effective_from')::date,
            (p ->> 'basis')::public.allocation_basis, nullif(trim(p ->> 'notes'), ''), auth.uid())
    returning id into v_id;
  else
    update public.allocation_rules
       set name = coalesce(nullif(trim(p ->> 'name'), ''), name),
           effective_from = (p ->> 'effective_from')::date,
           basis = (p ->> 'basis')::public.allocation_basis,
           notes = nullif(trim(p ->> 'notes'), '')
     where id = v_id and status = 'draft';
    if not found then raise exception 'Only draft rules can be edited.'; end if;
    delete from public.allocation_rule_lines where rule_id = v_id;
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    if nullif(v_line ->> 'percentage', '') is not null then
      insert into public.allocation_rule_lines (rule_id, fund_category_id, percentage)
      values (v_id, (v_line ->> 'fund_category_id')::uuid, (v_line ->> 'percentage')::numeric);
    end if;
  end loop;
  return v_id;
end
$$;

create or replace function public.activate_allocation_rule(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.allocation_rules;
  v_total numeric;
  v_full boolean;
begin
  perform public.require_permission('funds.manage');
  select * into v_rule from public.allocation_rules where id = p_id for update;
  if v_rule.id is null then raise exception 'Rule not found.'; end if;
  if v_rule.status <> 'draft' then raise exception 'Only draft rules can be activated.'; end if;
  select coalesce(sum(percentage), 0) into v_total from public.allocation_rule_lines where rule_id = p_id;
  select require_full_allocation into v_full from public.school_settings where id = 1;
  if v_total <= 0 then raise exception 'Enter at least one allocation percentage.'; end if;
  if v_total > 100 then
    raise exception '%', 'Allocation percentages total ' || trim_scale(v_total) || '%, which exceeds 100%.';
  end if;
  if v_full and v_total <> 100 then
    raise exception '%', 'School policy requires full allocation: percentages total ' || trim_scale(v_total) || '%, not 100%.';
  end if;
  if exists (select 1 from public.allocation_rule_lines l join public.fund_categories f on f.id = l.fund_category_id
             where l.rule_id = p_id and (not f.is_allocatable or not f.is_active) and l.percentage > 0) then
    raise exception 'A rule can only allocate to active, allocatable funds.';
  end if;
  if exists (select 1 from public.allocation_rules where status = 'active' and effective_from = v_rule.effective_from) then
    raise exception 'Another active rule already starts on %. Choose a different effective date.', v_rule.effective_from;
  end if;
  update public.allocation_rules set status = 'active', activated_by = auth.uid(), activated_at = now() where id = p_id;
end
$$;

create or replace function public.confirm_allocation_rule(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('settings.manage');
  update public.allocation_rules set confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_id and status = 'active';
  if not found then raise exception 'Only active rules can be confirmed.'; end if;
end
$$;

create or replace function public.delete_allocation_rule_draft(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('funds.manage');
  delete from public.allocation_rules where id = p_id and status = 'draft';
  if not found then raise exception 'Only draft rules can be deleted.'; end if;
end
$$;

-- ---------------------------------------------------------------------
-- Unified transaction ledger
-- ---------------------------------------------------------------------
create view public.v_transaction_ledger with (security_invoker = true) as
select 'INV-' || t.txn_no as ref_no, t.id, 'inventory_' || t.transaction_type::text as kind,
       t.txn_date as txn_date, i.name || coalesce(' — ' || t.reason, '') as description,
       i.name as item_name, t.quantity, round(abs(t.quantity) * coalesce(t.unit_cost, 0), 2) as amount,
       case when t.is_exception then 'exception' else 'posted' end as status,
       t.created_by, p.full_name as created_by_name, t.created_at, '/inventory/' || i.id as link
from public.inventory_transactions t
join public.inventory_items i on i.id = t.item_id
left join public.profiles p on p.id = t.created_by
where t.transaction_type not in ('stock_in', 'sale')  -- shown via receipts / daily sales
union all
select 'SR-' || r.receipt_no, r.id, 'stock_in', r.date_received,
       'Stock received: ' || i.name || coalesce(' (Ref ' || r.reference_no || ')', ''),
       i.name, r.quantity, r.total_cost, r.status::text, r.created_by, p.full_name, r.created_at,
       '/inventory/' || i.id
from public.stock_receipts r
join public.inventory_items i on i.id = r.item_id
left join public.profiles p on p.id = r.created_by
union all
select 'DS-' || to_char(d.sale_date, 'YYYYMMDD'), d.id, 'daily_sale', d.sale_date,
       'Daily sales — ' || d.line_count || ' items, ' || trim_scale(d.units_sold) || ' units sold',
       null, d.units_sold, d.sales_amount, d.status::text, d.created_by, d.created_by_name, d.created_at,
       '/daily-sales/' || d.id
from public.v_daily_sales d
union all
select 'FT-' || f.txn_no, f.id, f.transaction_type::text, f.transaction_date,
       f.description || coalesce(' — ' || f.requested_by, ''), null, null, f.amount, f.status::text,
       f.created_by, f.created_by_name, f.created_at, '/finance?txn=' || f.id
from public.v_financial_transactions f
union all
select 'FA-' || a.run_no, a.id, 'fund_allocation', a.period_end,
       'Fund allocation ' || to_char(a.period_start, 'Mon DD') || ' – ' || to_char(a.period_end, 'Mon DD, YYYY'),
       null, null, a.allocated_total, a.status::text, a.created_by, p.full_name, a.created_at, '/funds'
from public.fund_allocation_runs a
left join public.profiles p on p.id = a.created_by
union all
select 'FD-' || t.txn_no, t.id, 'fund_' || t.transaction_type::text, t.transaction_date,
       fc.name || coalesce(' — ' || t.description, ''), null, null, abs(t.amount), t.status::text,
       t.created_by, p.full_name, t.created_at, '/funds'
from public.fund_transactions t
join public.fund_categories fc on fc.id = t.fund_category_id
left join public.profiles p on p.id = t.created_by
where t.allocation_run_id is null
union all
select 'CO-' || substr(c.id::text, 1, 8), c.id, 'cash_carryover', c.entry_date, c.description, null, null,
       c.amount, c.status::text, c.created_by, p.full_name, c.created_at, '/finance'
from public.cash_carryovers c
left join public.profiles p on p.id = c.created_by;

-- ---------------------------------------------------------------------
-- Alerts (computed live from data — never stored or faked)
-- ---------------------------------------------------------------------
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

  -- Inventory status
  return query
  select 'out:' || i.id, 'critical', 'inventory', 'Out of stock: ' || i.name,
         i.name || ' has ' || trim_scale(i.quantity_on_hand) || ' ' || i.unit || ' on hand.',
         '/inventory/' || i.id, v_today
  from public.inventory_items i
  where i.is_active and i.quantity_on_hand <= 0
  order by i.name;

  return query
  select 'low:' || i.id || ':' || i.quantity_on_hand, 'warning', 'inventory', 'Low stock: ' || i.name,
         trim_scale(i.quantity_on_hand) || ' ' || i.unit || ' left (reorder level ' || trim_scale(i.reorder_level) || ').',
         '/inventory/' || i.id, v_today
  from public.inventory_items i
  where i.is_active and i.quantity_on_hand > 0 and i.quantity_on_hand <= i.reorder_level
  order by i.quantity_on_hand / nullif(i.reorder_level, 0);

  if st.expiration_tracking then
    return query
    select 'exp:' || i.id || ':' || i.expiration_date,
           case when i.expiration_date < v_today then 'critical' else 'warning' end, 'inventory',
           case when i.expiration_date < v_today then 'Expired: ' else 'Expiring soon: ' end || i.name,
           trim_scale(i.quantity_on_hand) || ' ' || i.unit || ' — expiry ' || to_char(i.expiration_date, 'Mon DD, YYYY') || '.',
           '/inventory/' || i.id, i.expiration_date
    from public.inventory_items i
    where i.is_active and i.quantity_on_hand > 0 and i.expiration_date is not null
      and i.expiration_date <= v_today + st.expiry_warning_days;
  end if;

  -- Unusual inventory adjustments recorded in the last 14 days
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

  -- Ledger integrity: quantity on hand must equal the sum of its ledger
  return query
  select 'recon:' || i.id, 'critical', 'discrepancy', 'Stock ledger mismatch: ' || i.name,
         'Quantity on hand (' || trim_scale(i.quantity_on_hand) || ') differs from the movement history (' ||
           trim_scale(coalesce(l.total, 0)) || ').', '/inventory/' || i.id, v_today
  from public.inventory_items i
  left join (select item_id, sum(quantity) as total from public.inventory_transactions group by item_id) l on l.item_id = i.id
  where i.quantity_on_hand <> coalesce(l.total, 0);

  -- Unsubmitted (draft) daily reports for past dates
  return query
  select 'draft:' || d.id, 'warning', 'daily_sales', 'Daily sales not finalized',
         'The record for ' || to_char(d.sale_date, 'FMMonth DD, YYYY') || ' is still a draft.',
         '/daily-sales/' || d.id, d.sale_date
  from public.daily_sales d
  where d.status = 'draft' and d.sale_date < v_today;

  -- Missing daily sales records on school days (only after the first record
  -- ever entered, and only within the active school year)
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

  -- Optional cash variance check (rule must be configured by an administrator)
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

  -- Negative fund balances
  return query
  select 'fund:' || f.id, 'critical', 'discrepancy', 'Negative fund balance: ' || f.name,
         'Balance is ₱' || to_char(public.fund_balance(f.id), 'FM999,999,990.00') || '.', '/funds', v_today
  from public.fund_categories f
  where public.fund_balance(f.id) < 0;

  -- Rules awaiting administrator confirmation
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
-- EXCEL IMPORT (staging → review → commit)
-- ---------------------------------------------------------------------
create or replace function public._import_fingerprint(p_target text, p_mapped jsonb)
returns text
language sql immutable
as $$
  select md5(p_target || ':' || (p_mapped - 'notes')::text)
$$;

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
              where h.report_date = (p_mapped ->> 'report_date')::date and b.status = 'committed')
    else false
  end
  or exists (select 1 from public.import_rows r join public.import_batches b on b.id = r.batch_id
             where r.fingerprint = p_fp and b.status = 'staged' and b.id <> p_batch
               and r.status in ('valid','review'))
$$;

create or replace function public.stage_import(p_batch jsonb, p_rows jsonb)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_batch uuid;
  v_row jsonb;
  v_fp text;
  v_status text;
  v_messages text[];
begin
  perform public.require_permission('import.run');
  insert into public.import_batches (file_name, sheet_name, target, total_rows, notes, created_by)
  values (p_batch ->> 'file_name', p_batch ->> 'sheet_name', p_batch ->> 'target',
          jsonb_array_length(p_rows), nullif(p_batch ->> 'notes', ''), auth.uid())
  returning id into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_fp := public._import_fingerprint(p_batch ->> 'target', v_row -> 'mapped');
    v_status := coalesce(v_row ->> 'status', 'review');
    v_messages := coalesce(array(select jsonb_array_elements_text(v_row -> 'messages')), '{}');
    if v_status not in ('valid','invalid','review','skipped') then v_status := 'review'; end if;
    if v_status in ('valid','review')
       and public._import_row_duplicate(p_batch ->> 'target', v_row -> 'mapped', v_fp, v_batch) then
      v_status := 'duplicate';
      v_messages := v_messages || 'Already imported or staged in another batch.'::text;
    end if;
    insert into public.import_rows (batch_id, row_ref, group_key, raw, mapped, status, messages, fingerprint)
    values (v_batch, v_row ->> 'row_ref', v_row ->> 'group_key', coalesce(v_row -> 'raw', '{}'),
            v_row -> 'mapped', v_status, v_messages, v_fp);
  end loop;
  return v_batch;
end
$$;

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

create or replace function public.commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.import_batches;
  v_row public.import_rows;
  v_group record;
  v_sale uuid;
  v_rate numeric;
  v_id uuid;
  m jsonb;
begin
  perform public.require_permission('import.run');
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'Import batch not found.'; end if;
  if v_batch.status <> 'staged' then raise exception 'This batch was already %.', v_batch.status; end if;
  perform public.set_audit_context('Excel import: ' || v_batch.file_name || ' / ' || v_batch.sheet_name);
  select canteen_share_rate into v_rate from public.school_settings where id = 1;

  if v_batch.target = 'daily_sales' then
    for v_group in
      select group_key, bool_and(status = 'valid') as all_valid, bool_or(status in ('valid','review','invalid')) as any_open
      from public.import_rows where batch_id = p_batch_id and status <> 'skipped'
      group by group_key order by group_key
    loop
      if not v_group.all_valid then
        update public.import_rows set messages = messages || 'Day not imported: other rows for this date need review.'::text
         where batch_id = p_batch_id and group_key = v_group.group_key and status = 'valid';
        continue;
      end if;
      begin
        if exists (select 1 from public.daily_sales where sale_date = v_group.group_key::date) then
          raise exception 'A daily sales record already exists for this date.';
        end if;
        insert into public.daily_sales (sale_date, status, actual_money, share_rate, source, import_batch_id,
                                        inventory_posted, created_by, updated_by, finalized_by, finalized_at, remarks)
        values (v_group.group_key::date, 'finalized',
                (select h.actual_money from public.historical_summary_references h
                   join public.import_batches b on b.id = h.batch_id
                  where h.report_date = v_group.group_key::date and b.status = 'committed'
                  order by h.created_at desc limit 1),
                v_rate, 'import', p_batch_id, false, auth.uid(), auth.uid(), auth.uid(), now(),
                'Imported from ' || v_batch.file_name)
        returning id into v_sale;
        for v_row in select * from public.import_rows where batch_id = p_batch_id and group_key = v_group.group_key
                       and status = 'valid' order by (mapped ->> 'line_no')::int loop
          m := v_row.mapped;
          insert into public.daily_sale_items (daily_sale_id, line_no, item_name_snapshot, consignee,
                                               total_quantity, unit_price, sold_quantity, share_quantity)
          values (v_sale, (m ->> 'line_no')::int, m ->> 'item_name', nullif(m ->> 'consignee', ''),
                  (m ->> 'total_quantity')::numeric, (m ->> 'unit_price')::numeric,
                  (m ->> 'sold_quantity')::numeric, coalesce((m ->> 'share_quantity')::numeric, (m ->> 'sold_quantity')::numeric));
        end loop;
        update public.import_rows set status = 'imported', entity_type = 'daily_sales', entity_id = v_sale
         where batch_id = p_batch_id and group_key = v_group.group_key and status = 'valid';
      exception when others then
        update public.import_rows set status = 'invalid', messages = messages || sqlerrm
         where batch_id = p_batch_id and group_key = v_group.group_key and status = 'valid';
      end;
    end loop;
  else
    for v_row in select * from public.import_rows where batch_id = p_batch_id and status = 'valid' loop
      m := v_row.mapped;
      begin
        if v_batch.target = 'financial_transactions' then
          if (m ->> 'amount')::numeric <= 0 then raise exception 'Amount must be greater than zero.'; end if;
          insert into public.financial_transactions (
            transaction_date, transaction_type, category_id, description, requested_by, amount, remarks,
            source_type, import_batch_id, import_fingerprint, created_by, updated_by)
          values (
            (m ->> 'transaction_date')::date, (m ->> 'transaction_type')::public.fin_txn_type,
            (select id from public.financial_categories
              where transaction_type = (m ->> 'transaction_type')::public.fin_txn_type and name = m ->> 'category'),
            m ->> 'description', nullif(m ->> 'requested_by', ''), (m ->> 'amount')::numeric,
            'Imported from ' || v_batch.file_name || ' ' || v_row.row_ref,
            'import', p_batch_id, v_row.fingerprint, auth.uid(), auth.uid())
          returning id into v_id;
          update public.import_rows set status = 'imported', entity_type = 'financial_transactions', entity_id = v_id
           where id = v_row.id;
        elsif v_batch.target = 'cash_carryovers' then
          insert into public.cash_carryovers (entry_date, description, amount, remarks, import_batch_id, import_fingerprint, created_by)
          values ((m ->> 'entry_date')::date, m ->> 'description', (m ->> 'amount')::numeric,
                  'Imported from ' || v_batch.file_name || ' ' || v_row.row_ref, p_batch_id, v_row.fingerprint, auth.uid())
          returning id into v_id;
          update public.import_rows set status = 'imported', entity_type = 'cash_carryovers', entity_id = v_id where id = v_row.id;
        elsif v_batch.target = 'summary_reference' then
          insert into public.historical_summary_references (
            batch_id, report_date, source_ref, actual_money, daily_canteen_shares, other_shares,
            gross_sales, expenses, deficit, net_sales)
          values (p_batch_id, (m ->> 'report_date')::date, v_row.row_ref, (m ->> 'actual_money')::numeric,
                  (m ->> 'daily_canteen_shares')::numeric, (m ->> 'other_shares')::numeric,
                  (m ->> 'gross_sales')::numeric, (m ->> 'expenses')::numeric, (m ->> 'deficit')::numeric,
                  (m ->> 'net_sales')::numeric)
          returning id into v_id;
          -- Actual money is an underlying input (not a formula): attach it to
          -- the matching imported daily sales record when that is still empty.
          update public.daily_sales set actual_money = (m ->> 'actual_money')::numeric
           where sale_date = (m ->> 'report_date')::date and actual_money is null
             and (m ->> 'actual_money') is not null;
          update public.import_rows set status = 'imported', entity_type = 'historical_summary_references', entity_id = v_id
           where id = v_row.id;
        else
          raise exception 'Unsupported import target %.', v_batch.target;
        end if;
      exception when others then
        update public.import_rows set status = 'invalid', messages = messages || sqlerrm where id = v_row.id;
      end;
    end loop;
  end if;

  update public.import_batches set status = 'committed', committed_by = auth.uid(), committed_at = now()
   where id = p_batch_id;

  return (select jsonb_object_agg(status, n) from (
            select status, count(*) as n from public.import_rows where batch_id = p_batch_id group by status) s);
end
$$;

create or replace function public.cancel_import_batch(p_batch_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('import.run');
  update public.import_batches set status = 'cancelled' where id = p_batch_id and status = 'staged';
  if not found then raise exception 'Only staged batches can be cancelled.'; end if;
end
$$;

-- Workbook vs system reconciliation for imported SUMMARY figures.
create or replace function public.report_import_reconciliation()
returns table (
  report_date date, source_ref text,
  wb_daily_canteen_shares numeric, sys_daily_canteen_shares numeric,
  wb_other_shares numeric, sys_other_shares numeric,
  wb_expenses numeric, sys_expenses numeric,
  wb_deficit numeric, sys_deficit numeric,
  wb_net_sales numeric, sys_net_sales numeric,
  matches boolean
)
language sql stable
set search_path = public, pg_temp
as $$
  with h as (
    select distinct on (h.report_date) h.*
    from public.historical_summary_references h
    join public.import_batches b on b.id = h.batch_id and b.status = 'committed'
    order by h.report_date, h.created_at desc
  ), s as (
    select * from public.report_daily_summary(
      (select coalesce(min(report_date), public.today_ph()) from h),
      (select coalesce(max(report_date), public.today_ph()) from h))
  )
  select h.report_date, h.source_ref,
         coalesce(h.daily_canteen_shares, 0), coalesce(s.daily_canteen_shares, 0),
         coalesce(h.other_shares, 0), coalesce(s.other_shares, 0),
         coalesce(h.expenses, 0), coalesce(s.expenses, 0),
         coalesce(h.deficit, 0), coalesce(s.deficit, 0),
         coalesce(h.net_sales, 0), coalesce(s.net_sales, 0),
         coalesce(h.daily_canteen_shares, 0) = coalesce(s.daily_canteen_shares, 0)
           and coalesce(h.other_shares, 0) = coalesce(s.other_shares, 0)
           and coalesce(h.expenses, 0) = coalesce(s.expenses, 0)
           and coalesce(h.deficit, 0) = coalesce(s.deficit, 0)
           and coalesce(h.net_sales, 0) = coalesce(s.net_sales, 0)
  from h left join s on s.report_date = h.report_date
  order by h.report_date
$$;
