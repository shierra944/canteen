// React Query hooks. All money/stock figures come from database views and
// functions; the browser only displays them.
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { rpc, supabase, unwrap } from './supabase';
import { round2, todayPH, toNumber } from './utils';
import type {
  Alert,
  CashCarryover,
  Category,
  Consignee,
  DailySale,
  DailySaleItem,
  DailySummaryRow,
  DashboardMetrics,
  FinCategory,
  FinancialTxn,
  InventoryItem,
  InventoryMovementRow,
  InventoryTxn,
  MonthlySummaryRow,
  PeriodTotals,
  Permission,
  Profile,
  SchoolSettings,
  SchoolYear,
  StockReceipt,
  Supplier,
} from './types';

export const keys = {
  settings: ['settings'] as const,
  schoolYears: ['school-years'] as const,
  categories: ['inventory-categories'] as const,
  suppliers: ['suppliers'] as const,
  consignees: ['consignees'] as const,
  inventory: ['inventory'] as const,
  item: (id: string) => ['inventory', id] as const,
  dailySales: ['daily-sales'] as const,
  finance: ['finance'] as const,
  finCategories: ['fin-categories'] as const,
  reports: ['reports'] as const,
  funds: ['funds'] as const,
  alerts: ['alerts'] as const,
  ledger: ['ledger'] as const,
  audit: ['audit'] as const,
  users: ['users'] as const,
  imports: ['imports'] as const,
};

// Anything that changes money or stock invalidates every derived view.
export const FINANCIAL_KEYS: QueryKey[] = [
  keys.inventory,
  keys.dailySales,
  keys.finance,
  keys.reports,
  keys.funds,
  keys.alerts,
  keys.ledger,
  keys.audit,
];

export function useInvalidate() {
  const qc = useQueryClient();
  return (list: QueryKey[] = FINANCIAL_KEYS) => Promise.all(list.map((k) => qc.invalidateQueries({ queryKey: k })));
}

/** Mutation wrapper: toasts errors/success and refreshes derived data. */
export function useAction<TArgs, TResult = unknown>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {},
) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await invalidate(opts.invalidate);
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------------------------------------------------------------- settings
export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => unwrap(await supabase.from('school_settings').select('*').eq('id', 1).single()) as SchoolSettings,
    staleTime: 5 * 60_000,
  });
}

export function useSchoolYears() {
  return useQuery({
    queryKey: keys.schoolYears,
    queryFn: async () => unwrap(await supabase.from('school_years').select('*').order('start_date', { ascending: false })) as SchoolYear[],
    staleTime: 5 * 60_000,
  });
}

export function usePermissionsCatalog() {
  return useQuery({
    queryKey: ['permissions-catalog'],
    queryFn: async () => unwrap(await supabase.from('permissions').select('*').order('sort_order')) as Permission[],
    staleTime: Infinity,
  });
}

// --------------------------------------------------------------- inventory
export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: async () => unwrap(await supabase.from('inventory_categories').select('*').order('name')) as Category[],
    staleTime: 5 * 60_000,
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: keys.suppliers,
    queryFn: async () => unwrap(await supabase.from('suppliers').select('*').order('name')) as Supplier[],
    staleTime: 5 * 60_000,
  });
}

export function useConsignees() {
  return useQuery({
    queryKey: keys.consignees,
    queryFn: async () => unwrap(await supabase.from('consignees').select('*').order('name')) as Consignee[],
    staleTime: 5 * 60_000,
  });
}

export function useInventory(includeArchived = false) {
  return useQuery({
    queryKey: [...keys.inventory, 'list', includeArchived],
    queryFn: async () => {
      let q = supabase.from('v_inventory_items').select('*').order('name');
      if (!includeArchived) q = q.eq('is_active', true);
      return unwrap(await q) as InventoryItem[];
    },
  });
}

export interface ProductTotals {
  item_id: string;
  delivered: number | string;
  sold: number | string;
  days: number;
  last_sale_date: string | null;
}

/** Running totals per product: handed over to the canteen so far, and sold so far. */
export function useProductTotals() {
  return useQuery({
    queryKey: [...keys.inventory, 'totals'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('v_product_totals').select('*')) as ProductTotals[];
      return new Map(rows.map((r) => [r.item_id, r]));
    },
  });
}

export function useInventoryItem(id: string | undefined) {
  return useQuery({
    queryKey: keys.item(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const [item, txns, receipts] = await Promise.all([
        supabase.from('v_inventory_items').select('*').eq('id', id!).single(),
        supabase.from('inventory_transactions').select('*').eq('item_id', id!).order('created_at', { ascending: false }).limit(500),
        supabase.from('stock_receipts').select('*').eq('item_id', id!).order('created_at', { ascending: false }).limit(200),
      ]);
      return {
        item: unwrap(item) as InventoryItem,
        txns: unwrap(txns) as InventoryTxn[],
        receipts: unwrap(receipts) as StockReceipt[],
      };
    },
  });
}

export function useProfilesMap() {
  return useQuery({
    queryKey: [...keys.users, 'names'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('profiles').select('id, full_name')) as Pick<Profile, 'id' | 'full_name'>[];
      return Object.fromEntries(rows.map((r) => [r.id, r.full_name])) as Record<string, string>;
    },
    staleTime: 5 * 60_000,
  });
}

// ------------------------------------------------------------- daily sales
export function useDailySales(filter: { start?: string; end?: string; schoolYearId?: string; status?: string }) {
  return useQuery({
    queryKey: [...keys.dailySales, 'list', filter],
    queryFn: async () => {
      let q = supabase.from('v_daily_sales').select('*').order('sale_date', { ascending: false }).limit(1000);
      if (filter.start) q = q.gte('sale_date', filter.start);
      if (filter.end) q = q.lte('sale_date', filter.end);
      if (filter.schoolYearId) q = q.eq('school_year_id', filter.schoolYearId);
      if (filter.status) q = q.eq('status', filter.status);
      return unwrap(await q) as DailySale[];
    },
  });
}

export function useDailySale(id: string | undefined) {
  return useQuery({
    queryKey: [...keys.dailySales, 'one', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [sale, items] = await Promise.all([
        supabase.from('v_daily_sales').select('*').eq('id', id!).single(),
        supabase.from('v_daily_sale_lines').select('*').eq('daily_sale_id', id!).order('line_no'),
      ]);
      return { sale: unwrap(sale) as DailySale, items: unwrap(items) as DailySaleItem[] };
    },
  });
}

export function useDailySalesByDates(start: string, end: string) {
  return useQuery({
    queryKey: [...keys.dailySales, 'report', start, end],
    queryFn: async () => {
      const sales = unwrap(
        await supabase.from('v_daily_sales').select('*').gte('sale_date', start).lte('sale_date', end).eq('status', 'finalized').order('sale_date'),
      ) as DailySale[];
      if (sales.length === 0) return { sales, items: [] as DailySaleItem[] };
      const items = unwrap(
        await supabase
          .from('v_daily_sale_lines')
          .select('*')
          .in('daily_sale_id', sales.map((s) => s.id))
          .order('line_no'),
      ) as DailySaleItem[];
      return { sales, items };
    },
  });
}

// ----------------------------------------------------------------- finance
export function useFinCategories() {
  return useQuery({
    queryKey: keys.finCategories,
    queryFn: async () => unwrap(await supabase.from('financial_categories').select('*').order('transaction_type').order('sort_order')) as FinCategory[],
    staleTime: 5 * 60_000,
  });
}

export interface FinFilter {
  start?: string;
  end?: string;
  type?: string;
  categoryId?: string;
  requestedBy?: string;
  status?: string;
  search?: string;
}

export function useFinancialTxns(f: FinFilter) {
  return useQuery({
    queryKey: [...keys.finance, 'list', f],
    queryFn: async () => {
      let q = supabase.from('v_financial_transactions').select('*').order('transaction_date', { ascending: false }).order('txn_no', { ascending: false }).limit(2000);
      if (f.start) q = q.gte('transaction_date', f.start);
      if (f.end) q = q.lte('transaction_date', f.end);
      if (f.type) q = q.eq('transaction_type', f.type);
      if (f.categoryId) q = q.eq('category_id', f.categoryId);
      if (f.status) q = q.eq('status', f.status);
      if (f.requestedBy) q = q.ilike('requested_by', `%${f.requestedBy}%`);
      if (f.search) q = q.or(`description.ilike.%${f.search.replace(/[,()]/g, ' ')}%,requested_by.ilike.%${f.search.replace(/[,()]/g, ' ')}%`);
      return unwrap(await q) as FinancialTxn[];
    },
  });
}

export function useCarryovers(start?: string, end?: string) {
  return useQuery({
    queryKey: [...keys.finance, 'carryovers', start, end],
    queryFn: async () => {
      let q = supabase.from('cash_carryovers').select('*').order('entry_date', { ascending: false });
      if (start) q = q.gte('entry_date', start);
      if (end) q = q.lte('entry_date', end);
      return unwrap(await q) as CashCarryover[];
    },
  });
}

// ----------------------------------------------------------------- reports
export function useDashboardMetrics(start: string, end: string) {
  return useQuery({
    queryKey: [...keys.reports, 'dashboard', start, end],
    queryFn: () => rpc<DashboardMetrics>('dashboard_metrics', { p_start: start, p_end: end }),
  });
}

/**
 * Money on hand right now, across all records:
 * carry-over cash + gross sales − expenses − deficits − fund expenditures.
 * Deficits are cash shortages, so they always reduce cash (whatever the
 * Net Sales setting says).
 */
export async function fetchMoneyOnHand(asOf: string = todayPH()) {
  const [totals, spent] = await Promise.all([
    rpc<PeriodTotals>('report_period_totals', { p_start: '2000-01-01', p_end: asOf }),
    supabase.from('fund_transactions').select('amount').eq('transaction_type', 'expenditure').eq('status', 'posted').lte('transaction_date', asOf),
  ]);
  const fundSpent = -(unwrap(spent) as { amount: number | string }[]).reduce((s, r) => s + toNumber(r.amount), 0);
  const carryover = toNumber(totals.carryover);
  const gross = toNumber(totals.gross_sales);
  const expenses = toNumber(totals.expenses);
  const deficit = toNumber(totals.deficit);
  return { asOf, total: round2(carryover + gross - expenses - deficit - fundSpent), carryover, gross, expenses, deficit, fundSpent };
}

/** Money on hand at the end of each date (closing cash), keyed by date. */
export function useCashAsOf(dates: string[], enabled = true) {
  const unique = [...new Set(dates)].sort();
  return useQuery({
    queryKey: [...keys.reports, 'cash-as-of', unique],
    enabled: enabled && unique.length > 0,
    queryFn: async () => Object.fromEntries(await Promise.all(unique.map(async (d) => [d, (await fetchMoneyOnHand(d)).total] as const))) as Record<string, number>,
  });
}

export function useMoneyOnHand(enabled = true) {
  const today = todayPH();
  return useQuery({
    queryKey: [...keys.reports, 'money-on-hand', today],
    enabled,
    queryFn: () => fetchMoneyOnHand(today),
  });
}

export function useDailySummary(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: [...keys.reports, 'daily', start, end],
    enabled,
    queryFn: () => rpc<DailySummaryRow[]>('report_daily_summary', { p_start: start, p_end: end }),
  });
}

export function useMonthlySummary(start: string, end: string) {
  return useQuery({
    queryKey: [...keys.reports, 'monthly', start, end],
    queryFn: () => rpc<MonthlySummaryRow[]>('report_monthly_summary', { p_start: start, p_end: end }),
  });
}

export function useExpenseBreakdown(start: string, end: string) {
  return useQuery({
    queryKey: [...keys.reports, 'breakdown', start, end],
    queryFn: () => rpc<{ transaction_type: string; category: string; total: string; txn_count: number }[]>('report_expense_breakdown', { p_start: start, p_end: end }),
  });
}

export function useInventoryMovement(start: string, end: string) {
  return useQuery({
    queryKey: [...keys.reports, 'inventory', start, end],
    queryFn: () => rpc<InventoryMovementRow[]>('report_inventory_movement', { p_start: start, p_end: end }),
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: keys.alerts,
    queryFn: async () => (await rpc<Alert[]>('get_alerts')).filter((a) => !/^(rule|fund):/.test(a.alert_key)),
    refetchInterval: 5 * 60_000,
  });
}
