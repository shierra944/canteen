import type { AllocationBasis, FinTxnType, InvTxnType, StockStatus } from './types';

export const FIN_TYPE_LABEL: Record<FinTxnType, string> = {
  sale: 'Sale',
  expense: 'Expense',
  deficit: 'Deficit',
};

export const INV_TYPE_LABEL: Record<InvTxnType, string> = {
  opening: 'Opening stock',
  stock_in: 'Stock received',
  stock_in_reversal: 'Stock receipt reversed',
  sale: 'Sold',
  sale_reversal: 'Sale correction',
  damaged: 'Damaged',
  expired: 'Expired',
  spoiled: 'Spoiled',
  missing: 'Missing',
  count_correction: 'Physical count correction',
  other_adjustment: 'Other adjustment',
};

export const ADJUSTMENT_TYPES: { value: InvTxnType; label: string; help: string }[] = [
  { value: 'damaged', label: 'Damaged items', help: 'Quantity removed because it is damaged.' },
  { value: 'expired', label: 'Expired products', help: 'Quantity removed because it has expired.' },
  { value: 'spoiled', label: 'Spoiled food', help: 'Quantity removed because it spoiled.' },
  { value: 'missing', label: 'Missing inventory', help: 'Quantity that cannot be found.' },
  { value: 'count_correction', label: 'Physical count correction', help: 'Enter the actual counted quantity; the difference is recorded.' },
  { value: 'other_adjustment', label: 'Other authorized adjustment', help: 'Positive adds stock, negative removes stock.' },
];

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
  consigned: 'Consigned',
};

export const BASIS_LABEL: Record<AllocationBasis, string> = {
  gross_sales: 'Gross Sales',
  net_sales: 'Net Sales',
  gross_plus_carryover: 'Gross Sales + Cash Carry-overs (workbook)',
  net_plus_carryover: 'Net Sales + Cash Carry-overs',
};

export const LEDGER_KIND_LABEL: Record<string, string> = {
  stock_in: 'Stock-in',
  daily_sale: 'Daily sales',
  sale: 'Other sale',
  expense: 'Expense',
  deficit: 'Deficit',
  fund_allocation: 'Fund allocation',
  fund_expenditure: 'Fund expenditure',
  fund_adjustment: 'Fund adjustment',
  fund_opening: 'Fund opening balance',
  cash_carryover: 'Cash carry-over',
  inventory_opening: 'Opening stock',
  inventory_stock_in_reversal: 'Stock-in reversal',
  inventory_sale_reversal: 'Sale correction',
  inventory_damaged: 'Damaged',
  inventory_expired: 'Expired',
  inventory_spoiled: 'Spoiled',
  inventory_missing: 'Missing',
  inventory_count_correction: 'Count correction',
  inventory_other_adjustment: 'Inventory adjustment',
};

export const PERMISSION_GROUPS: { title: string; codes: string[] }[] = [
  { title: 'Reports', codes: ['reports.view', 'reports.export', 'audit.view'] },
  { title: 'Daily sales', codes: ['sales.record', 'sales.finalize', 'sales.correct'] },
  { title: 'Finance', codes: ['finance.record', 'finance.correct', 'funds.manage'] },
  { title: 'Inventory', codes: ['inventory.manage', 'inventory.stock_in', 'inventory.adjust', 'inventory.negative_exception'] },
  { title: 'Administration', codes: ['users.manage', 'settings.manage', 'import.run'] },
];

export const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: [],
  staff: ['sales.record', 'sales.finalize', 'finance.record', 'reports.view'],
  viewer: ['reports.view'],
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  staff: 'Canteen-in-Charge / Staff',
  viewer: 'Read-only Viewer',
};
