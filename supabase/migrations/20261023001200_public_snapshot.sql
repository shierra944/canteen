-- =====================================================================
-- Migration 12: public summary for the login page.
--
-- Approved by the school: the login page shows the canteen's current
-- money on hand and this month's headline totals to anyone who opens the
-- site. Only these totals are returned — no transactions, names or any
-- other record leaves the database.
-- =====================================================================

create or replace function public.public_dashboard_snapshot()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public.today_ph();
  v_month_start date := date_trunc('month', v_today)::date;
  v_all jsonb := public.report_period_totals('2000-01-01', v_today);
  v_month jsonb := public.report_period_totals(v_month_start, v_today);
  v_fund_spent numeric;
  v_deduct boolean;
begin
  select coalesce(-sum(amount), 0) into v_fund_spent
    from public.fund_transactions
   where transaction_type = 'expenditure' and status = 'posted' and transaction_date <= v_today;
  select deduct_deficit_in_net into v_deduct from public.school_settings where id = 1;

  return jsonb_build_object(
    'as_of', v_today,
    'month_start', v_month_start,
    -- money on hand = carry-over + gross − expenses − deficits − fund spending (all records to date)
    'money_on_hand', round((v_all ->> 'carryover')::numeric + (v_all ->> 'gross_sales')::numeric
                           - (v_all ->> 'expenses')::numeric - (v_all ->> 'deficit')::numeric - v_fund_spent, 2),
    'carryover', (v_all ->> 'carryover')::numeric,
    'gross_sales', (v_all ->> 'gross_sales')::numeric,
    'expenses', (v_all ->> 'expenses')::numeric,
    'deficit', (v_all ->> 'deficit')::numeric,
    'fund_spent', v_fund_spent,
    'month', jsonb_build_object(
      'gross_sales', (v_month ->> 'gross_sales')::numeric,
      'daily_canteen_shares', (v_month ->> 'daily_canteen_shares')::numeric,
      'other_shares', (v_month ->> 'other_shares')::numeric,
      'expenses', (v_month ->> 'expenses')::numeric,
      'deficit', (v_month ->> 'deficit')::numeric,
      'net_sales', (v_month ->> 'net_sales')::numeric,
      'deduct_deficit_in_net', coalesce(v_deduct, true)
    )
  );
end
$$;

revoke execute on function public.public_dashboard_snapshot() from public;
grant execute on function public.public_dashboard_snapshot() to anon, authenticated;
