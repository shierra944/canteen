// Shapes of rows/views returned by the database. Numeric columns arrive as
// strings or numbers from PostgREST; always pass them through toNumber().
type Num = number | string;

export type AppRole = 'admin' | 'staff' | 'viewer';
export type FinTxnType = 'sale' | 'expense' | 'deficit';
export type RecordStatus = 'posted' | 'reversed';
export type DailySaleStatus = 'draft' | 'finalized';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type InvTxnType =
  | 'opening'
  | 'stock_in'
  | 'stock_in_reversal'
  | 'sale'
  | 'sale_reversal'
  | 'damaged'
  | 'expired'
  | 'spoiled'
  | 'missing'
  | 'count_correction'
  | 'other_adjustment';
export type AllocationBasis = 'gross_sales' | 'net_sales' | 'gross_plus_carryover' | 'net_plus_carryover';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: AppRole;
  is_active: boolean;
  position: string | null;
  created_at: string;
}

export interface Signatory {
  label: string;
  name: string;
  position: string;
}

export interface SchoolSettings {
  header_line1: string;
  header_line2: string;
  region: string;
  division: string;
  school_name: string;
  school_id_no: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  currency: 'PHP';
  canteen_share_rate: Num;
  deduct_deficit_in_net: boolean;
  cash_variance_basis: 'disabled' | 'sales_amount' | 'net_cash_flow';
  formula_confirmed_at: string | null;
  formula_confirmed_by: string | null;
  require_full_allocation: boolean;
  inventory_valuation: 'weighted_average' | 'latest_cost';
  default_reorder_level: Num;
  expiration_tracking: boolean;
  expiry_warning_days: number;
  permitted_adjustments: InvTxnType[];
  unusual_adjustment_value: Num;
  unusual_adjustment_pct: Num;
  school_days: number[];
  missing_sales_lookback_days: number;
  signatories: Signatory[];
  report_number_prefix: string | null;
  export_include_signatories: boolean;
  default_report_period: 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'school_year';
  updated_at: string;
}

export interface SchoolYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
}

export interface InventoryItem {
  id: string;
  item_code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string;
  quantity_on_hand: Num;
  unit_cost: Num;
  selling_price: Num;
  reorder_level: Num;
  supplier_id: string | null;
  supplier_name: string | null;
  default_consignee: string | null;
  expiration_date: string | null;
  description: string | null;
  stock_value: Num;
  stock_status: StockStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryTxn {
  id: string;
  txn_no: number;
  item_id: string;
  transaction_type: InvTxnType;
  txn_date: string;
  quantity: Num;
  unit_cost: Num | null;
  balance_before: Num;
  balance_after: Num;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  is_exception: boolean;
  reverses_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StockReceipt {
  id: string;
  receipt_no: number;
  item_id: string;
  quantity: Num;
  unit_cost: Num;
  total_cost: Num;
  supplier_id: string | null;
  date_received: string;
  reference_no: string | null;
  remarks: string | null;
  status: RecordStatus;
  reversal_reason: string | null;
  created_at: string;
}

export interface DailySale {
  id: string;
  sale_date: string;
  school_year_id: string | null;
  status: DailySaleStatus;
  actual_money: Num | null;
  remarks: string | null;
  share_rate: Num | null;
  source: 'manual' | 'import';
  inventory_posted: boolean;
  version: number;
  correction_count: number;
  created_by: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
  line_count: number;
  total_quantity: Num;
  units_sold: Num;
  sales_amount: Num;
  unsold_units: Num;
  unsold_amount: Num;
  share_units: Num;
  canteen_shares: Num;
  created_by_name: string | null;
  finalized_by_name: string | null;
}

export interface DailySaleItem {
  id: string;
  daily_sale_id: string;
  line_no: number;
  inventory_item_id: string | null;
  item_name_snapshot: string;
  unit_snapshot: string | null;
  consignee: string | null;
  total_quantity: Num;
  unit_price: Num;
  sold_quantity: Num;
  share_quantity: Num;
  sales_amount: Num;
  unsold_quantity: Num;
  unsold_amount: Num;
  posted_txn_id: string | null;
}

export interface FinCategory {
  id: string;
  name: string;
  transaction_type: FinTxnType;
  is_active: boolean;
  sort_order: number;
}

export interface FinancialTxn {
  id: string;
  txn_no: number;
  transaction_date: string;
  transaction_type: FinTxnType;
  category_id: string | null;
  category_name: string | null;
  description: string;
  requested_by: string | null;
  amount: Num;
  payment_method: string | null;
  reference_number: string | null;
  remarks: string | null;
  included_in_daily_sales: boolean;
  source_type: 'manual' | 'stock_receipt' | 'import';
  status: RecordStatus;
  reversal_reason: string | null;
  reversed_at: string | null;
  version: number;
  created_by: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashCarryover {
  id: string;
  entry_date: string;
  description: string;
  amount: Num;
  remarks: string | null;
  status: RecordStatus;
  reversal_reason: string | null;
  created_at: string;
}

export interface DailySummaryRow {
  report_date: string;
  actual_money: Num | null;
  sales_amount: Num;
  units_sold: Num;
  share_units: Num;
  daily_canteen_shares: Num;
  other_shares: Num;
  gross_sales: Num;
  expenses: Num;
  deficit: Num;
  net_sales: Num;
  included_sales: Num;
  has_daily_sale: boolean;
}

export interface MonthlySummaryRow {
  month_start: string;
  school_year: string | null;
  days_reported: number;
  actual_money: Num;
  daily_canteen_shares: Num;
  other_shares: Num;
  gross_sales: Num;
  expenses: Num;
  deficit: Num;
  net_sales: Num;
  sales_amount: Num;
}

export interface PeriodTotals {
  start: string;
  end: string;
  days_reported: number;
  actual_money: Num;
  sales_amount: Num;
  units_sold: Num;
  share_units: Num;
  daily_canteen_shares: Num;
  other_shares: Num;
  gross_sales: Num;
  expenses: Num;
  deficit: Num;
  net_sales: Num;
  included_sales: Num;
  carryover: Num;
}

export interface DashboardMetrics extends PeriodTotals {
  inventory_value: Num;
  inventory_valuation: string;
  items_active: number;
  items_in_stock: number;
  items_low_stock: number;
  items_out_of_stock: number;
  draft_daily_sales: number;
  deduct_deficit_in_net: boolean;
  formula_confirmed: boolean;
}

export interface InventoryMovementRow {
  item_id: string;
  item_code: string;
  item_name: string;
  category_name: string | null;
  unit: string;
  opening: Num;
  received: Num;
  sold: Num;
  losses: Num;
  other_adjustments: Num;
  closing: Num;
  quantity_on_hand: Num;
  ledger_balance: Num;
  reconciled: boolean;
  unit_cost: Num;
  stock_value: Num;
  reorder_level: Num;
  stock_status: StockStatus;
  is_active: boolean;
}

export interface FundCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_allocatable: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface FundSummaryRow {
  fund_category_id: string;
  code: string;
  name: string;
  sort_order: number;
  is_allocatable: boolean;
  percentage: Num | null;
  opening_balance: Num;
  allocations: Num;
  expenditures: Num;
  adjustments: Num;
  closing_balance: Num;
  available: Num;
  utilization_pct: Num;
}

export interface AllocationRule {
  id: string;
  name: string;
  effective_from: string;
  basis: AllocationBasis;
  status: 'draft' | 'active' | 'retired';
  notes: string | null;
  confirmed_at: string | null;
  activated_at: string | null;
  created_at: string;
  allocation_rule_lines?: { fund_category_id: string; percentage: Num }[];
}

export interface AllocationRun {
  id: string;
  run_no: number;
  period_start: string;
  period_end: string;
  rule_id: string;
  basis: AllocationBasis;
  gross_sales: Num;
  net_sales: Num;
  carryover: Num;
  base_amount: Num;
  allocated_total: Num;
  remarks: string | null;
  status: RecordStatus;
  reversal_reason: string | null;
  created_at: string;
}

export interface FundTxn {
  id: string;
  txn_no: number;
  fund_category_id: string;
  transaction_type: 'opening' | 'allocation' | 'expenditure' | 'adjustment' | 'reversal' | 'allocation_reversal';
  amount: Num;
  transaction_date: string;
  allocation_run_id: string | null;
  percentage_applied: Num | null;
  description: string | null;
  reference_no: string | null;
  remarks: string | null;
  status: RecordStatus;
  reversal_reason: string | null;
  created_at: string;
}

export interface AllocationPreview {
  rule: { id: string; name: string; basis: AllocationBasis; effective_from: string; confirmed: boolean } | null;
  totals: PeriodTotals;
  base_amount?: Num;
  lines?: { fund_category_id: string; name: string; percentage: Num; amount: Num }[];
  total_percentage?: Num;
  allocated_total?: Num;
  unallocated?: Num;
  overlapping_runs?: { run_no: number; period_start: string; period_end: string }[];
  error?: string;
}

export interface Alert {
  alert_key: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  message: string;
  link: string | null;
  occurred_on: string | null;
}

export interface LedgerRow {
  ref_no: string;
  id: string;
  kind: string;
  txn_date: string;
  description: string;
  item_name: string | null;
  quantity: Num | null;
  amount: Num | null;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  link: string | null;
}

export interface AuditLog {
  id: number;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  context: string | null;
  created_at: string;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  sheet_name: string;
  target: string;
  status: 'staged' | 'committed' | 'cancelled';
  total_rows: number;
  notes: string | null;
  created_at: string;
  committed_at: string | null;
}

export interface ImportRow {
  id: string;
  batch_id: string;
  row_ref: string;
  group_key: string | null;
  raw: Record<string, unknown>;
  mapped: Record<string, unknown>;
  status: 'valid' | 'invalid' | 'duplicate' | 'review' | 'imported' | 'skipped';
  messages: string[];
}

export interface Permission {
  code: string;
  description: string;
  is_write: boolean;
  sort_order: number;
}
