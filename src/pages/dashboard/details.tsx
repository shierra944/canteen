import { useMemo } from 'react';
import { useDailySummary, useFinancialTxns, useInventory } from '@/lib/queries';
import { describePeriod } from '@/lib/periods';
import { peso, toNumber } from '@/lib/utils';
import type { DashboardMetrics, FinancialTxn, InventoryItem } from '@/lib/types';
import { DetailDialog, type DetailSection } from '@/components/DetailDialog';
import { StockBadge } from '@/components/ui/badge';

export type DashboardDetailKind = 'gross' | 'expenses' | 'other' | 'net' | 'inventory' | 'stock';

const txnColumns = [
  { key: 'transaction_date', header: 'Date', format: 'date' as const },
  { key: 'description', header: 'Item / description' },
  { key: 'category_name', header: 'Category' },
  { key: 'requested_by', header: 'Requested / given by' },
  { key: 'amount', header: 'Amount', format: 'peso' as const },
];

/** The records behind each dashboard summary card. */
export function DashboardDetail({
  kind,
  start,
  end,
  metrics,
  onClose,
}: {
  kind: DashboardDetailKind | null;
  start: string;
  end: string;
  metrics: DashboardMetrics | undefined;
  onClose: () => void;
}) {
  const open = kind !== null;
  const period = describePeriod(start, end);
  const close = (o: boolean) => !o && onClose();
  if (kind === 'gross' || kind === 'net') return <DailyBreakdown kind={kind} start={start} end={end} period={period} metrics={metrics} open={open} onOpenChange={close} />;
  if (kind === 'expenses' || kind === 'other') return <TxnBreakdown kind={kind} start={start} end={end} period={period} open={open} onOpenChange={close} />;
  if (kind === 'inventory' || kind === 'stock') return <StockBreakdown kind={kind} open={open} onOpenChange={close} />;
  return null;
}

function DailyBreakdown({
  kind,
  start,
  end,
  period,
  metrics,
  open,
  onOpenChange,
}: {
  kind: 'gross' | 'net';
  start: string;
  end: string;
  period: string;
  metrics: DashboardMetrics | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data = [], isLoading } = useDailySummary(start, end);
  const sum = (k: keyof (typeof data)[number]) => data.reduce((a, r) => a + toNumber(r[k]), 0);
  const deduct = metrics?.deduct_deficit_in_net !== false;
  const section: DetailSection =
    kind === 'gross'
      ? {
          columns: [
            { key: 'report_date', header: 'Date', format: 'date' },
            { key: 'daily_canteen_shares', header: 'Canteen shares', format: 'peso' },
            { key: 'other_shares', header: 'Other shares', format: 'peso' },
            { key: 'gross_sales', header: 'Gross sales', format: 'peso' },
          ],
          rows: data as unknown as Record<string, unknown>[],
          totals: { report_date: 'Total', daily_canteen_shares: sum('daily_canteen_shares'), other_shares: sum('other_shares'), gross_sales: sum('gross_sales') },
          empty: 'No finalized daily sales or other sales in this period.',
        }
      : {
          columns: [
            { key: 'report_date', header: 'Date', format: 'date' },
            { key: 'gross_sales', header: 'Gross sales', format: 'peso' },
            { key: 'expenses', header: 'Expenses', format: 'peso' },
            { key: 'deficit', header: 'Deficit', format: 'peso' },
            { key: 'net_sales', header: 'Net sales', format: 'peso', render: (r) => <span className={toNumber(r.net_sales) < 0 ? 'text-danger-600' : ''}>{peso(r.net_sales)}</span> },
          ],
          rows: data as unknown as Record<string, unknown>[],
          totals: { report_date: 'Total', gross_sales: sum('gross_sales'), expenses: sum('expenses'), deficit: sum('deficit'), net_sales: sum('net_sales') },
          empty: 'No records in this period.',
        };
  return (
    <DetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={kind === 'gross' ? 'Total gross sales' : 'Net sales'}
      description={`${period} · day by day, from finalized daily sales and posted transactions`}
      loading={isLoading}
      summary={
        kind === 'gross'
          ? [
              { label: 'Daily canteen shares', value: peso(sum('daily_canteen_shares')) },
              { label: 'Other shares', value: peso(sum('other_shares')) },
              { label: 'Gross sales', value: peso(sum('gross_sales')), strong: true },
            ]
          : [
              { label: 'Gross sales', value: peso(sum('gross_sales')) },
              { label: '− Expenses', value: peso(sum('expenses')) },
              { label: deduct ? '− Deficit' : 'Deficit (not deducted)', value: peso(sum('deficit')) },
              { label: 'Net sales', value: peso(sum('net_sales')), strong: true },
            ]
      }
      sections={[section]}
      link={{ to: '/reports?tab=consolidated', label: 'Open consolidated report' }}
    />
  );
}

function TxnBreakdown({
  kind,
  start,
  end,
  period,
  open,
  onOpenChange,
}: {
  kind: 'expenses' | 'other';
  start: string;
  end: string;
  period: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: rows = [], isLoading } = useFinancialTxns({ start, end, type: kind === 'expenses' ? undefined : 'sale', status: 'posted' });
  const total = (list: FinancialTxn[]) => list.reduce((a, r) => a + toNumber(r.amount), 0);
  if (kind === 'expenses') {
    const expenses = rows.filter((r) => r.transaction_type === 'expense');
    const deficits = rows.filter((r) => r.transaction_type === 'deficit');
    return (
      <DetailDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Total expenses"
        description={`${period} · posted expenses; deficits are listed separately because they are a different category`}
        loading={isLoading}
        summary={[
          { label: 'Expenses', value: peso(total(expenses)), strong: true },
          { label: 'Deficits (separate)', value: peso(total(deficits)) },
          { label: 'Entries', value: expenses.length },
        ]}
        sections={[
          { title: 'Expenses', columns: txnColumns, rows: expenses, totals: { transaction_date: 'Total', amount: total(expenses) }, empty: 'No expenses in this period.' },
          ...(deficits.length ? [{ title: 'Deficits', columns: txnColumns, rows: deficits, totals: { transaction_date: 'Total', amount: total(deficits) } }] : []),
        ]}
        link={{ to: '/finance', label: 'Open Expenses & Other Sales' }}
      />
    );
  }
  const counted = rows.filter((r) => !r.included_in_daily_sales);
  const included = rows.filter((r) => r.included_in_daily_sales);
  return (
    <DetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Other sales"
      description={`${period} · posted sales recorded in Expenses & Other Sales`}
      loading={isLoading}
      summary={[
        { label: 'Counted as other shares', value: peso(total(counted)), strong: true },
        { label: 'Already in daily sales (not counted)', value: peso(total(included)) },
      ]}
      sections={[
        { title: 'Counted in gross sales', columns: txnColumns, rows: counted, totals: { transaction_date: 'Total', amount: total(counted) }, empty: 'No other sales in this period.' },
        ...(included.length ? [{ title: 'Already included in daily sales — not counted again', columns: txnColumns, rows: included, totals: { transaction_date: 'Total', amount: total(included) } }] : []),
      ]}
      link={{ to: '/finance', label: 'Open Expenses & Other Sales' }}
    />
  );
}

export function StockBreakdown({ kind, open, onOpenChange }: { kind: 'inventory' | 'stock'; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: items = [], isLoading } = useInventory();
  const stock = useMemo(() => items.filter((i) => !i.is_consigned), [items]);
  if (kind === 'inventory') {
    const rows = [...stock].sort((a, b) => toNumber(b.stock_value) - toNumber(a.stock_value));
    const total = rows.reduce((a, i) => a + toNumber(i.stock_value), 0);
    return (
      <DetailDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Total inventory value"
        description="Canteen-owned stock only — quantity on hand × cost per unit. Consigned items belong to their consignees and are not valued."
        loading={isLoading}
        summary={[
          { label: 'Inventory value', value: peso(total), strong: true },
          { label: 'Stock items', value: rows.length },
        ]}
        sections={[
          {
            columns: [
              { key: 'name', header: 'Product' },
              { key: 'quantity_on_hand', header: 'On hand', format: 'qty', render: (i: InventoryItem) => `${toNumber(i.quantity_on_hand)} ${i.unit}` , align: 'right' },
              { key: 'unit_cost', header: 'Cost per unit', format: 'peso' },
              { key: 'stock_value', header: 'Value', format: 'peso' },
              { key: 'share', header: 'Share of total', align: 'right', render: (i: InventoryItem) => (total ? `${((toNumber(i.stock_value) / total) * 100).toFixed(1)}%` : '—') },
            ],
            rows,
            totals: { name: 'Total', stock_value: total },
            empty: 'No canteen-stock items yet.',
          },
        ]}
        link={{ to: '/inventory?kind=stock', label: 'Open Products & Consignees' }}
      />
    );
  }
  const rows = stock
    .filter((i) => i.stock_status === 'low_stock' || i.stock_status === 'out_of_stock')
    .sort((a, b) => toNumber(a.quantity_on_hand) - toNumber(b.quantity_on_hand));
  return (
    <DetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Low-stock items"
      description="Canteen-stock items at or below their reorder level. Record a stock-in when new stock arrives."
      loading={isLoading}
      summary={[
        { label: 'Out of stock', value: rows.filter((i) => i.stock_status === 'out_of_stock').length },
        { label: 'Low stock', value: rows.filter((i) => i.stock_status === 'low_stock').length },
      ]}
      sections={[
        {
          columns: [
            { key: 'name', header: 'Product' },
            { key: 'quantity_on_hand', header: 'On hand', align: 'right', render: (i: InventoryItem) => `${toNumber(i.quantity_on_hand)} ${i.unit}` },
            { key: 'reorder_level', header: 'Reorder at', format: 'qty' },
            { key: 'status', header: 'Status', render: (i: InventoryItem) => <StockBadge status={i.stock_status} /> },
          ],
          rows,
          empty: 'All canteen-stock items are above their reorder levels.',
        },
      ]}
      link={{ to: '/inventory?status=low_stock', label: 'Open Products & Consignees' }}
    />
  );
}
