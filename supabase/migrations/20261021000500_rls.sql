-- =====================================================================
-- Migration 5: Row Level Security & grants
--
-- Principle: authenticated users may READ what their role allows; almost
-- all WRITES go through SECURITY DEFINER functions that check
-- permissions and keep ledgers consistent. Direct table writes are only
-- allowed for simple reference data, guarded by has_permission().
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'school_years','school_settings','profiles','permissions','user_permissions',
    'inventory_categories','suppliers','inventory_items','inventory_transactions','stock_receipts',
    'import_batches','daily_sales','daily_sale_items','financial_categories','financial_transactions',
    'cash_carryovers','fund_categories','allocation_rules','allocation_rule_lines','fund_allocation_runs',
    'fund_transactions','audit_logs','import_rows','historical_summary_references'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- Reference data readable by every active user
create policy "active users read" on public.school_years for select to authenticated using (public.is_active_user());
create policy "active users read" on public.school_settings for select to authenticated using (public.is_active_user());
create policy "active users read" on public.permissions for select to authenticated using (public.is_active_user());
create policy "active users read" on public.inventory_categories for select to authenticated using (public.is_active_user());
create policy "active users read" on public.suppliers for select to authenticated using (public.is_active_user());
create policy "active users read" on public.inventory_items for select to authenticated using (public.is_active_user());
create policy "active users read" on public.inventory_transactions for select to authenticated using (public.is_active_user());
create policy "active users read" on public.stock_receipts for select to authenticated using (public.is_active_user());
create policy "active users read" on public.financial_categories for select to authenticated using (public.is_active_user());
create policy "active users read" on public.fund_categories for select to authenticated using (public.is_active_user());

-- Profiles: everyone active sees names (for "recorded by"); a deactivated
-- user can still read their own row so the app can explain the lockout.
create policy "read profiles" on public.profiles for select to authenticated
  using (public.is_active_user() or id = auth.uid());
create policy "read own or managed permissions" on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.manage'));

-- Financial data: requires a finance-related permission
create policy "finance readers" on public.daily_sales for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.daily_sale_items for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.financial_transactions for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.cash_carryovers for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.allocation_rules for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.allocation_rule_lines for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.fund_allocation_runs for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.fund_transactions for select to authenticated using (public.can_view_finance());
create policy "finance readers" on public.historical_summary_references for select to authenticated using (public.can_view_finance());

create policy "auditors read" on public.audit_logs for select to authenticated using (public.has_permission('audit.view'));
create policy "importers read" on public.import_batches for select to authenticated using (public.has_permission('import.run'));
create policy "importers read" on public.import_rows for select to authenticated using (public.has_permission('import.run'));

-- Simple reference-data writes (audited by triggers)
create policy "inventory managers insert" on public.inventory_categories for insert to authenticated
  with check (public.has_permission('inventory.manage'));
create policy "inventory managers update" on public.inventory_categories for update to authenticated
  using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));
create policy "inventory managers insert" on public.suppliers for insert to authenticated
  with check (public.has_permission('inventory.manage') or public.has_permission('inventory.stock_in'));
create policy "inventory managers update" on public.suppliers for update to authenticated
  using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));
-- Item details (not quantity — see guard trigger) can be edited/archived.
create policy "inventory managers update" on public.inventory_items for update to authenticated
  using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));

create policy "settings managers insert" on public.financial_categories for insert to authenticated
  with check (public.has_permission('settings.manage'));
create policy "settings managers update" on public.financial_categories for update to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
create policy "settings managers insert" on public.school_years for insert to authenticated
  with check (public.has_permission('settings.manage'));
create policy "settings managers update" on public.school_years for update to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
create policy "fund managers insert" on public.fund_categories for insert to authenticated
  with check (public.has_permission('settings.manage'));
create policy "fund managers update" on public.fund_categories for update to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

-- Column-level hardening for direct updates
revoke update on public.inventory_items from authenticated;
grant update (item_code, name, category_id, unit, unit_cost, selling_price, reorder_level, supplier_id,
              default_consignee, expiration_date, description, is_active)
  on public.inventory_items to authenticated;
revoke insert, update, delete on public.profiles, public.user_permissions, public.audit_logs,
  public.inventory_transactions, public.stock_receipts, public.daily_sales, public.daily_sale_items,
  public.financial_transactions, public.cash_carryovers, public.allocation_rules, public.allocation_rule_lines,
  public.fund_allocation_runs, public.fund_transactions, public.import_batches, public.import_rows,
  public.historical_summary_references, public.school_settings, public.permissions
  from authenticated;
revoke insert, delete on public.inventory_items from authenticated;
revoke delete on public.inventory_categories, public.suppliers, public.financial_categories,
  public.school_years, public.fund_categories from authenticated;

grant select on public.v_inventory_items, public.v_daily_sales, public.v_financial_transactions,
  public.v_transaction_ledger to authenticated;
revoke all on public.v_inventory_items, public.v_daily_sales, public.v_financial_transactions,
  public.v_transaction_ledger from anon;

-- Functions: nothing for anon; internal helpers not callable directly.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._apply_stock(uuid, public.inv_txn_type, numeric, numeric, text, uuid, text, date, boolean, uuid) from authenticated;
revoke execute on function public.bootstrap_admin(text) from authenticated;
revoke execute on function public.handle_new_auth_user() from authenticated;
revoke execute on function public.log_audit(text, text, text, jsonb, jsonb, text) from authenticated;
revoke execute on function public.set_audit_context(text) from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
