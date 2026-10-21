-- =====================================================================
-- Migration 2: identity/permission helpers, generic triggers, audit log
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permission model
--   admin  : every permission
--   staff  : role defaults + permissions granted by an administrator
--   viewer : read-only; write permissions are ALWAYS denied even if a row
--            exists in user_permissions (cannot be escalated from the UI)
-- ---------------------------------------------------------------------
create or replace function public.role_default_permissions(p_role public.app_role)
returns text[]
language sql immutable
as $$
  select case p_role
    when 'staff' then array['sales.record','sales.finalize','finance.record','reports.view']
    when 'viewer' then array['reports.view']
    else array[]::text[]
  end
$$;

create or replace function public.current_profile()
returns public.profiles
language sql stable security definer
set search_path = public, pg_temp
as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_active and role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_is_write boolean;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null or not v_profile.is_active then
    return false;
  end if;
  if v_profile.role = 'admin' then
    return true;
  end if;
  select is_write into v_is_write from public.permissions where code = p_permission;
  if v_is_write is null then
    return false; -- unknown permission code
  end if;
  if v_profile.role = 'viewer' and v_is_write then
    return false;
  end if;
  return p_permission = any(public.role_default_permissions(v_profile.role))
    or exists (select 1 from public.user_permissions
               where user_id = v_profile.id and permission = p_permission);
end
$$;

-- Effective permission list for the signed-in user (drives the UI only;
-- the database re-checks every operation).
create or replace function public.my_permissions()
returns text[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(code order by sort_order), '{}')
  from public.permissions
  where public.has_permission(code)
$$;

create or replace function public.can_view_finance()
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select public.has_permission('reports.view')
      or public.has_permission('sales.record')
      or public.has_permission('finance.record')
      or public.has_permission('funds.manage')
$$;

create or replace function public.require_permission(p_permission text)
returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission(p_permission) then
    raise exception 'You do not have permission to perform this action (%).', p_permission
      using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- New auth users get an INACTIVE viewer profile. Roles are never read
-- from user metadata, so sign-up data cannot grant privileges.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    'viewer',
    false
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- One-time bootstrap from the Supabase SQL editor (NOT callable by app users):
--   select public.bootstrap_admin('principal@deped.gov.ph');
create or replace function public.bootstrap_admin(p_email text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'No user with email %. Create the user in Supabase Auth first.', p_email;
  end if;
  update public.profiles set role = 'admin', is_active = true, updated_at = now() where id = v_id;
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, new_values, context)
  values (null, 'system', 'bootstrap_admin', 'profiles', v_id::text, jsonb_build_object('email', p_email), 'SQL editor');
end
$$;

-- ---------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger suppliers_touch before update on public.suppliers for each row execute function public.touch_updated_at();
create trigger inventory_items_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
create trigger daily_sales_touch before update on public.daily_sales for each row execute function public.touch_updated_at();
create trigger financial_transactions_touch before update on public.financial_transactions for each row execute function public.touch_updated_at();
create trigger school_settings_touch before update on public.school_settings for each row execute function public.touch_updated_at();

create or replace function public.school_year_for(p_date date)
returns uuid
language sql stable
set search_path = public, pg_temp
as $$
  select id from public.school_years
  where p_date between start_date and end_date
  order by start_date desc
  limit 1
$$;

create or replace function public.assign_school_year()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'daily_sales' then
    new.school_year_id := public.school_year_for(new.sale_date);
  elsif tg_table_name = 'financial_transactions' then
    new.school_year_id := public.school_year_for(new.transaction_date);
  elsif tg_table_name = 'cash_carryovers' then
    new.school_year_id := public.school_year_for(new.entry_date);
  end if;
  return new;
end
$$;

create trigger daily_sales_sy before insert or update of sale_date on public.daily_sales
  for each row execute function public.assign_school_year();
create trigger financial_transactions_sy before insert or update of transaction_date on public.financial_transactions
  for each row execute function public.assign_school_year();
create trigger cash_carryovers_sy before insert or update of entry_date on public.cash_carryovers
  for each row execute function public.assign_school_year();

-- Quantity on hand can only change through public._apply_stock(), which
-- writes the ledger row in the same transaction.
create or replace function public.guard_inventory_quantity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity_on_hand <> 0 and coalesce(current_setting('app.stock_write', true), '') <> 'on' then
      raise exception 'Initial stock must be recorded through the inventory functions.';
    end if;
  elsif new.quantity_on_hand is distinct from old.quantity_on_hand
        and coalesce(current_setting('app.stock_write', true), '') <> 'on' then
    raise exception 'Quantity on hand cannot be edited directly. Record a stock-in or a stock adjustment instead.';
  end if;
  return new;
end
$$;

create trigger inventory_items_guard_qty before insert or update on public.inventory_items
  for each row execute function public.guard_inventory_quantity();

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% records are permanent and cannot be % .', tg_table_name, lower(tg_op)
    using errcode = '42501';
end
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.forbid_mutation();
create trigger inventory_transactions_immutable before update or delete on public.inventory_transactions
  for each row execute function public.forbid_mutation();

-- Ledgers may only change their reversal bookkeeping columns.
create or replace function public.guard_ledger_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% records cannot be deleted; reverse them instead.', tg_table_name using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status','reversal_reason','reversed_by','reversed_at'])
     is distinct from (to_jsonb(old) - array['status','reversal_reason','reversed_by','reversed_at']) then
    raise exception 'Posted % records cannot be edited; reverse them instead.', tg_table_name using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger fund_transactions_guard before update or delete on public.fund_transactions
  for each row execute function public.guard_ledger_update();
create trigger fund_allocation_runs_guard before update or delete on public.fund_allocation_runs
  for each row execute function public.guard_ledger_update();
create trigger cash_carryovers_guard before update or delete on public.cash_carryovers
  for each row execute function public.guard_ledger_update();

-- Activated allocation rules are frozen (history must never change).
create or replace function public.guard_allocation_rule_lines()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.allocation_rules
  where id = coalesce(new.rule_id, old.rule_id);
  if v_status is distinct from 'draft' then
    raise exception 'Percentages of an activated allocation rule cannot be changed. Create a new rule with a new effective date.';
  end if;
  return coalesce(new, old);
end
$$;

create trigger allocation_rule_lines_guard before insert or update or delete on public.allocation_rule_lines
  for each row execute function public.guard_allocation_rule_lines();

create or replace function public.guard_allocation_rule()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft allocation rules can be deleted.';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (
      new.effective_from is distinct from old.effective_from
      or new.basis is distinct from old.basis) then
    raise exception 'An activated allocation rule cannot be modified.';
  end if;
  return new;
end
$$;

create trigger allocation_rules_guard before update or delete on public.allocation_rules
  for each row execute function public.guard_allocation_rule();

-- ---------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------
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
          p_action, p_entity_type, p_entity_id, p_old, p_new, p_context);
end
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_ignore text[] := array['updated_at', 'version'];
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_ignore;
    v_new := to_jsonb(new) - v_ignore;
    if v_old = v_new then
      return new;
    end if;
    -- keep only the changed keys
    select jsonb_object_agg(key, v_old -> key), jsonb_object_agg(key, v_new -> key)
      into v_old, v_new
    from jsonb_object_keys(v_new) as key
    where v_new -> key is distinct from v_old -> key;
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
  end if;

  perform public.log_audit(
    lower(tg_op), tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id',
             to_jsonb(new) ->> 'user_id', to_jsonb(old) ->> 'user_id',
             to_jsonb(new) ->> 'rule_id', to_jsonb(old) ->> 'rule_id'),
    v_old, v_new, null);
  return coalesce(new, old);
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'school_settings','school_years','profiles','user_permissions',
    'inventory_categories','suppliers','inventory_items','stock_receipts',
    'daily_sales','financial_categories','financial_transactions','cash_carryovers',
    'fund_categories','allocation_rules','allocation_rule_lines','fund_allocation_runs','fund_transactions',
    'import_batches'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t || '_audit', t);
  end loop;
end
$$;
