-- =====================================================================
-- QNHS Canteen Inventory & Financial Management System
-- Migration 1: core schema (types, tables, constraints, indexes)
--
-- Money uses numeric(14,2); quantities use numeric(12,3) (kilos etc).
-- Derived line values (sales amount, unsold qty/amount, stock value)
-- are GENERATED columns so the database, not the browser, is the
-- source of truth for every calculated figure.
-- =====================================================================

create type public.app_role as enum ('admin', 'staff', 'viewer');
create type public.daily_sale_status as enum ('draft', 'finalized');
-- Workbook "NATURE OF ITEM" values in EXPENSES & OTHER SALES.
create type public.fin_txn_type as enum ('sale', 'expense', 'deficit');
create type public.record_status as enum ('posted', 'reversed');
create type public.inv_txn_type as enum (
  'opening', 'stock_in', 'stock_in_reversal', 'sale', 'sale_reversal',
  'damaged', 'expired', 'spoiled', 'missing', 'count_correction', 'other_adjustment'
);
create type public.fund_txn_type as enum (
  'opening', 'allocation', 'allocation_reversal', 'expenditure', 'adjustment', 'reversal'
);
create type public.allocation_basis as enum (
  'gross_sales', 'net_sales', 'gross_plus_carryover', 'net_plus_carryover'
);

-- ---------------------------------------------------------------------
-- Settings & reference data
-- ---------------------------------------------------------------------
create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^\d{4}-\d{4}$'),
  start_date date not null,
  end_date date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);
create unique index school_years_one_active on public.school_years (is_active) where is_active;

create table public.school_settings (
  id smallint primary key default 1 check (id = 1),
  -- School information / official report header
  header_line1 text not null default 'Republic of the Philippines',
  header_line2 text not null default 'Department of Education',
  region text not null default 'Region VII, Central Visayas',
  division text not null default 'Schools Division of Cebu City, South District 2',
  school_name text not null default 'QUIOT NATIONAL HIGH SCHOOL',
  school_id_no text not null default '312515',
  address text default 'Sitio Bogo, Quiot, Cebu City',
  phone text default '(032) 326-2623',
  email text default 'quioths.cebucity@deped.gov.ph',
  logo_url text default '/logos/qnhs.png',
  currency text not null default 'PHP' check (currency = 'PHP'),
  -- Financial rules (see docs/FINANCIAL_RULES.md)
  canteen_share_rate numeric(10,2) not null default 1.00 check (canteen_share_rate >= 0),
  deduct_deficit_in_net boolean not null default true,
  cash_variance_basis text not null default 'disabled'
    check (cash_variance_basis in ('disabled', 'sales_amount', 'net_cash_flow')),
  formula_confirmed_at timestamptz,
  formula_confirmed_by uuid,
  require_full_allocation boolean not null default true,
  -- Inventory rules
  inventory_valuation text not null default 'weighted_average'
    check (inventory_valuation in ('weighted_average', 'latest_cost')),
  default_reorder_level numeric(12,3) not null default 10 check (default_reorder_level >= 0),
  expiration_tracking boolean not null default true,
  expiry_warning_days integer not null default 7 check (expiry_warning_days between 0 and 365),
  permitted_adjustments text[] not null default
    array['damaged','expired','spoiled','missing','count_correction','other_adjustment'],
  unusual_adjustment_value numeric(14,2) not null default 500 check (unusual_adjustment_value >= 0),
  unusual_adjustment_pct numeric(6,2) not null default 25 check (unusual_adjustment_pct >= 0),
  -- Alerts
  school_days smallint[] not null default array[1,2,3,4,5]::smallint[], -- ISO dow (1=Mon)
  missing_sales_lookback_days integer not null default 14 check (missing_sales_lookback_days between 1 and 120),
  -- Reports
  signatories jsonb not null default '[
    {"label":"Prepared by:","name":"CELESTE C. DURAN","position":"Canteen Manager"},
    {"label":"Noted by:","name":"JUAN DAMASCENO D. VILLAVER","position":"School Principal"}
  ]'::jsonb,
  report_number_prefix text default 'QNHS-CANTEEN',
  export_include_signatories boolean not null default true,
  default_report_period text not null default 'this_month'
    check (default_report_period in ('today','this_week','this_month','this_quarter','school_year')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------
-- Users, roles & permissions
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default false,
  position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.permissions (
  code text primary key,
  description text not null,
  is_write boolean not null,
  sort_order integer not null default 0
);

create table public.user_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null references public.permissions (code) on delete cascade,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index inventory_categories_name_key on public.inventory_categories (lower(name));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_key on public.suppliers (lower(name));

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null check (length(trim(item_code)) > 0),
  name text not null check (length(trim(name)) > 0),
  category_id uuid references public.inventory_categories (id),
  unit text not null check (length(trim(unit)) > 0),
  -- Only changed by public._apply_stock(); see guard trigger.
  quantity_on_hand numeric(12,3) not null default 0,
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  supplier_id uuid references public.suppliers (id),
  default_consignee text,
  expiration_date date,
  description text,
  stock_value numeric(14,2) generated always as (round(quantity_on_hand * unit_cost, 2)) stored,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_items_code_key on public.inventory_items (lower(item_code));
create index inventory_items_name_idx on public.inventory_items (lower(name));
create index inventory_items_category_idx on public.inventory_items (category_id);
create index inventory_items_active_idx on public.inventory_items (is_active);

-- Permanent stock ledger. Insert-only (guard trigger blocks update/delete).
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_no bigint generated always as identity unique,
  item_id uuid not null references public.inventory_items (id),
  transaction_type public.inv_txn_type not null,
  txn_date date not null default current_date,
  quantity numeric(12,3) not null check (quantity <> 0), -- signed: + in, - out
  unit_cost numeric(12,2) check (unit_cost >= 0),
  balance_before numeric(12,3) not null,
  balance_after numeric(12,3) not null,
  reference_type text,   -- 'daily_sale_item' | 'stock_receipt' | 'adjustment' | 'item_create'
  reference_id uuid,
  reason text,
  is_exception boolean not null default false,   -- admin-authorised negative stock
  reverses_id uuid references public.inventory_transactions (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (balance_after = balance_before + quantity),
  check (
    (transaction_type in ('opening','stock_in','sale_reversal') and quantity > 0)
    or (transaction_type in ('sale','stock_in_reversal','damaged','expired','spoiled','missing') and quantity < 0)
    or transaction_type in ('count_correction','other_adjustment')
  ),
  check (transaction_type not in ('damaged','expired','spoiled','missing','count_correction','other_adjustment')
         or length(trim(coalesce(reason, ''))) > 0)
);
create index inventory_transactions_item_idx on public.inventory_transactions (item_id, created_at);
create index inventory_transactions_date_idx on public.inventory_transactions (txn_date);
create index inventory_transactions_type_idx on public.inventory_transactions (transaction_type);
create index inventory_transactions_ref_idx on public.inventory_transactions (reference_type, reference_id);
-- A ledger row can be reversed at most once.
create unique index inventory_transactions_reverses_key on public.inventory_transactions (reverses_id)
  where reverses_id is not null;

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint generated always as identity unique,
  item_id uuid not null references public.inventory_items (id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  total_cost numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  supplier_id uuid references public.suppliers (id),
  date_received date not null,
  reference_no text,
  remarks text,
  inventory_txn_id uuid references public.inventory_transactions (id),
  expense_txn_id uuid, -- FK added after financial_transactions exists
  status public.record_status not null default 'posted',
  reversal_reason text,
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  idempotency_key uuid unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index stock_receipts_date_idx on public.stock_receipts (date_received);
create index stock_receipts_item_idx on public.stock_receipts (item_id);

-- ---------------------------------------------------------------------
-- Daily sales (workbook sheet: DAILY SALES)
-- ---------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  sheet_name text not null,
  target text not null check (target in ('daily_sales','financial_transactions','summary_reference','cash_carryovers','fund_categories')),
  status text not null default 'staged' check (status in ('staged','committed','cancelled')),
  total_rows integer not null default 0,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  committed_by uuid references public.profiles (id),
  committed_at timestamptz
);

create table public.daily_sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null unique,
  school_year_id uuid references public.school_years (id),
  status public.daily_sale_status not null default 'draft',
  actual_money numeric(14,2) check (actual_money >= 0),
  remarks text,
  -- Canteen share rate (PHP per share unit) frozen when finalized so a later
  -- settings change never rewrites historical reports.
  share_rate numeric(10,2) check (share_rate >= 0),
  source text not null default 'manual' check (source in ('manual','import')),
  import_batch_id uuid references public.import_batches (id),
  inventory_posted boolean not null default false,
  version integer not null default 1,
  correction_count integer not null default 0,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  finalized_by uuid references public.profiles (id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or (share_rate is not null and finalized_at is not null))
);
create index daily_sales_status_idx on public.daily_sales (status);
create index daily_sales_sy_idx on public.daily_sales (school_year_id);

create table public.daily_sale_items (
  id uuid primary key default gen_random_uuid(),
  daily_sale_id uuid not null references public.daily_sales (id) on delete cascade,
  line_no integer not null check (line_no > 0),
  inventory_item_id uuid references public.inventory_items (id),
  item_name_snapshot text not null check (length(trim(item_name_snapshot)) > 0),
  unit_snapshot text,
  consignee text,
  total_quantity numeric(12,3) not null check (total_quantity >= 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  sold_quantity numeric(12,3) not null default 0 check (sold_quantity >= 0),
  -- Workbook SHARE column: a QUANTITY (=SOLD by default), not money.
  share_quantity numeric(12,3) not null default 0 check (share_quantity >= 0),
  sales_amount numeric(14,2) generated always as (round(sold_quantity * unit_price, 2)) stored,
  unsold_quantity numeric(12,3) generated always as (total_quantity - sold_quantity) stored,
  unsold_amount numeric(14,2) generated always as (round((total_quantity - sold_quantity) * unit_price, 2)) stored,
  posted_txn_id uuid references public.inventory_transactions (id),
  created_at timestamptz not null default now(),
  check (sold_quantity <= total_quantity),
  unique (daily_sale_id, line_no)
);
create index daily_sale_items_sale_idx on public.daily_sale_items (daily_sale_id);
create index daily_sale_items_item_idx on public.daily_sale_items (inventory_item_id);

-- ---------------------------------------------------------------------
-- Expenses & other sales (workbook sheet: EXPENSES & OTHER SALES)
-- ---------------------------------------------------------------------
create table public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  transaction_type public.fin_txn_type not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  unique (transaction_type, name)
);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_no bigint generated always as identity unique,
  transaction_date date not null,
  school_year_id uuid references public.school_years (id),
  transaction_type public.fin_txn_type not null,
  category_id uuid references public.financial_categories (id),
  description text not null check (length(trim(description)) > 0),   -- workbook ITEM
  requested_by text,                                                  -- REQUESTED OR GIVEN BY
  amount numeric(14,2) not null check (amount > 0),
  payment_method text,
  reference_number text,
  remarks text,
  -- TRUE only when this revenue is ALREADY part of a Daily Sales record;
  -- such rows are listed but never added to Other Shares (no double counting).
  included_in_daily_sales boolean not null default false,
  source_type text not null default 'manual' check (source_type in ('manual','stock_receipt','import')),
  source_id uuid,
  import_batch_id uuid references public.import_batches (id),
  import_fingerprint text unique,
  status public.record_status not null default 'posted',
  reversal_reason text,
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  corrects_id uuid references public.financial_transactions (id),
  idempotency_key uuid unique,
  version integer not null default 1,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not included_in_daily_sales or transaction_type = 'sale')
);
create index financial_transactions_date_idx on public.financial_transactions (transaction_date);
create index financial_transactions_type_idx on public.financial_transactions (transaction_type, status);
create index financial_transactions_category_idx on public.financial_transactions (category_id);
create index financial_transactions_requested_idx on public.financial_transactions (lower(requested_by));
create unique index financial_transactions_source_key on public.financial_transactions (source_type, source_id)
  where source_id is not null and status = 'posted';

alter table public.stock_receipts
  add constraint stock_receipts_expense_fk foreign key (expense_txn_id) references public.financial_transactions (id);

-- Cash brought forward (workbook SUMMARY: "January - cash", "c/o ...").
create table public.cash_carryovers (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  school_year_id uuid references public.school_years (id),
  description text not null check (length(trim(description)) > 0),
  amount numeric(14,2) not null check (amount > 0),
  remarks text,
  status public.record_status not null default 'posted',
  reversal_reason text,
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  import_batch_id uuid references public.import_batches (id),
  import_fingerprint text unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index cash_carryovers_date_idx on public.cash_carryovers (entry_date);

-- ---------------------------------------------------------------------
-- Funds (workbook sheets: TYPE OF FUNDS + SUMMARY allocation table)
-- ---------------------------------------------------------------------
create table public.fund_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  description text,
  is_allocatable boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.allocation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  effective_from date not null,
  basis public.allocation_basis not null,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  notes text,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  activated_by uuid references public.profiles (id),
  activated_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index allocation_rules_active_effective_key on public.allocation_rules (effective_from)
  where status = 'active';

create table public.allocation_rule_lines (
  rule_id uuid not null references public.allocation_rules (id) on delete cascade,
  fund_category_id uuid not null references public.fund_categories (id),
  percentage numeric(6,3) not null check (percentage >= 0 and percentage <= 100),
  primary key (rule_id, fund_category_id)
);

create table public.fund_allocation_runs (
  id uuid primary key default gen_random_uuid(),
  run_no bigint generated always as identity unique,
  period_start date not null,
  period_end date not null,
  rule_id uuid not null references public.allocation_rules (id),
  basis public.allocation_basis not null,
  gross_sales numeric(14,2) not null,
  net_sales numeric(14,2) not null,
  carryover numeric(14,2) not null,
  base_amount numeric(14,2) not null check (base_amount >= 0),
  allocated_total numeric(14,2) not null,
  remarks text,
  status public.record_status not null default 'posted',
  reversal_reason text,
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.fund_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_no bigint generated always as identity unique,
  fund_category_id uuid not null references public.fund_categories (id),
  transaction_type public.fund_txn_type not null,
  amount numeric(14,2) not null check (amount <> 0), -- signed: + increases balance
  transaction_date date not null,
  allocation_run_id uuid references public.fund_allocation_runs (id),
  percentage_applied numeric(6,3),
  description text,
  reference_no text,
  remarks text,
  status public.record_status not null default 'posted',
  reverses_id uuid references public.fund_transactions (id),
  reversal_reason text,
  reversed_by uuid references public.profiles (id),
  reversed_at timestamptz,
  idempotency_key uuid unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (
    (transaction_type in ('opening','allocation') and amount > 0)
    or (transaction_type in ('expenditure','allocation_reversal') and amount < 0)
    or transaction_type in ('adjustment','reversal')
  )
);
create index fund_transactions_fund_idx on public.fund_transactions (fund_category_id, transaction_date);
create index fund_transactions_run_idx on public.fund_transactions (allocation_run_id);
create unique index fund_transactions_reverses_key on public.fund_transactions (reverses_id) where reverses_id is not null;

-- ---------------------------------------------------------------------
-- Audit log (insert-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  user_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  context text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_user_idx on public.audit_logs (user_id);

-- ---------------------------------------------------------------------
-- Excel import staging / review area
-- ---------------------------------------------------------------------
create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_ref text not null,          -- e.g. 'DAILY SALES!K17'
  group_key text,                 -- e.g. sale date for daily sales lines
  raw jsonb not null,
  mapped jsonb not null,
  status text not null check (status in ('valid','invalid','duplicate','review','imported','skipped')),
  messages text[] not null default '{}',
  fingerprint text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index import_rows_batch_idx on public.import_rows (batch_id, status);

-- Workbook SUMMARY figures, kept ONLY for reconciliation (never summed).
create table public.historical_summary_references (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  report_date date not null,
  source_ref text,
  actual_money numeric(14,2),
  daily_canteen_shares numeric(14,2),
  other_shares numeric(14,2),
  gross_sales numeric(14,2),
  expenses numeric(14,2),
  deficit numeric(14,2),
  net_sales numeric(14,2),
  created_at timestamptz not null default now()
);
create index historical_summary_references_date_idx on public.historical_summary_references (report_date);
