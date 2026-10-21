import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Receipt, ShoppingBasket } from 'lucide-react';
import { useApp } from '@/providers/app';
import { supabase, unwrap } from '@/lib/supabase';
import { useDailySalesByDates, useFinancialTxns, useInventory, useInventoryMovement } from '@/lib/queries';
import { describePeriod } from '@/lib/periods';
import { formatDate, peso, qty, toNumber } from '@/lib/utils';
import { FIN_TYPE_LABEL, INV_TYPE_LABEL, STOCK_STATUS_LABEL } from '@/lib/labels';
import type { InventoryTxn } from '@/lib/types';
import type { OfficialReport } from '@/lib/export/report';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { StockBadge, TypeBadge, Badge } from '@/components/ui/badge';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import type { ReportFilters } from './ReportsPage';

// --------------------------------------------------------- C. Daily sales
export function DailySalesReport({ filters }: { filters: ReportFilters }) {
  const { start, end } = filters.period;
  const { activeSchoolYear } = useApp();
  const { data, isLoading, error, refetch } = useDailySalesByDates(start, end);
  const { data: inventory = [] } = useInventory(true);
  const invCat = useMemo(() => new Map(inventory.map((i) => [i.id, i.category_id])), [inventory]);
  const days = useMemo(() => {
    if (!data) return [];
    const term = filters.item.trim().toLowerCase();
    return data.sales
      .map((s) => {
        const items = data.items.filter(
          (i) =>
            i.daily_sale_id === s.id &&
            (!term || i.item_name_snapshot.toLowerCase().includes(term)) &&
            (!filters.invCategoryId || (i.inventory_item_id && invCat.get(i.inventory_item_id) === filters.invCategoryId)),
        );
        const sum = (k: 'sold_quantity' | 'sales_amount' | 'unsold_quantity' | 'unsold_amount' | 'share_quantity' | 'total_quantity' | 'canteen_share' | 'remit_amount') => items.reduce((a, i) => a + toNumber(i[k]), 0);
        return { sale: s, items, totals: { total: sum('total_quantity'), sold: sum('sold_quantity'), amount: sum('sales_amount'), unsold: sum('unsold_quantity'), unsold_amount: sum('unsold_amount'), share: sum('share_quantity'), canteen_share: sum('canteen_share'), remit: sum('remit_amount') } };
      })
      .filter((d) => d.items.length > 0);
  }, [data, filters.item, filters.invCategoryId, invCat]);
  const grand = days.reduce(
    (a, d) => ({ sold: a.sold + d.totals.sold, amount: a.amount + d.totals.amount, unsold: a.unsold + d.totals.unsold, unsold_amount: a.unsold_amount + d.totals.unsold_amount, share: a.share + d.totals.share, canteen_share: a.canteen_share + d.totals.canteen_share, remit: a.remit + d.totals.remit }),
    { sold: 0, amount: 0, unsold: 0, unsold_amount: 0, share: 0, canteen_share: 0, remit: 0 },
  );
  const cols = [
    { key: 'no', header: 'No.', width: 6 },
    { key: 'item', header: 'Item', width: 26 },
    { key: 'consignee', header: 'Consignee', width: 16 },
    { key: 'sold', header: 'Qty Sold', format: 'qty' as const, width: 10 },
    { key: 'price', header: 'Selling Price', format: 'peso' as const, width: 12 },
    { key: 'amount', header: 'Sales Amount', format: 'peso' as const, width: 13 },
    { key: 'unsold', header: 'Unsold Qty', format: 'qty' as const, width: 10 },
    { key: 'unsold_amount', header: 'Unsold Amount', format: 'peso' as const, width: 13 },
    { key: 'canteen_share', header: 'Canteen Share', format: 'peso' as const, width: 12 },
    { key: 'remit', header: 'Remit', format: 'peso' as const, width: 12 },
  ];
  const report = (): OfficialReport => ({
    title: 'Daily Sales Report',
    period: describePeriod(start, end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Daily-Sales-Report-${start}_${end}`,
    orientation: 'landscape',
    columns: [],
    rows: [],
    sections: days.map((d) => ({
      title: formatDate(d.sale.sale_date, 'long'),
      columns: cols,
      rows: d.items.map((i, idx) => ({ no: idx + 1, item: i.item_name_snapshot, consignee: i.is_canteen_stock ? 'Canteen stock' : i.consignee, sold: i.sold_quantity, price: i.unit_price, amount: i.sales_amount, unsold: i.unsold_quantity, unsold_amount: i.unsold_amount, canteen_share: i.canteen_share, remit: i.is_canteen_stock ? null : i.remit_amount })),
      totals: { item: 'DAILY TOTAL', sold: d.totals.sold, amount: d.totals.amount, unsold: d.totals.unsold, unsold_amount: d.totals.unsold_amount, canteen_share: d.totals.canteen_share, remit: d.totals.remit },
    })),
    summary: [
      { label: 'Days reported', value: String(days.length) },
      { label: 'Total units sold', value: qty(grand.sold) },
      { label: 'Total sales amount', value: peso(grand.amount), emphasis: true },
      { label: 'Total unsold amount', value: peso(grand.unsold_amount) },
      { label: 'Total canteen share', value: peso(grand.canteen_share), emphasis: true },
      { label: 'Total remitted to consignees', value: peso(grand.remit) },
    ],
  });

  return (
    <>
      <Card className="no-print">
        <CardHeader title="C. Daily Sales Report" description="Items sold per reporting date (finalized records)" icon={<ShoppingBasket />} actions={<ExportMenu report={report} disabled={days.length === 0} />} />
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton cols={8} />
        ) : days.length === 0 ? (
          <EmptyState icon={<ShoppingBasket />} title="No finalized daily sales match the filters" />
        ) : (
          <div className="divide-y divide-surface-border">
            {days.map((d) => (
              <div key={d.sale.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-page/70 px-5 py-2.5">
                  <div className="font-semibold">{formatDate(d.sale.sale_date, 'long')}</div>
                  <div className="text-sm text-ink-muted">
                    {qty(d.totals.sold)} units · <span className="font-semibold text-brand-700">{peso(d.totals.amount)}</span>
                  </div>
                </div>
                <Table>
                  <THead>
                    <tr>
                      <TH>No.</TH>
                      <TH>Item</TH>
                      <TH>Consignee</TH>
                      <TH align="right">Sold</TH>
                      <TH align="right">Price</TH>
                      <TH align="right">Amount</TH>
                      <TH align="right">Unsold</TH>
                      <TH align="right">Unsold amt</TH>
                      <TH align="right">Canteen share</TH>
                      <TH align="right">Remit</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {d.items.map((i) => (
                      <TR key={i.id}>
                        <TD className="text-ink-muted">{i.line_no}</TD>
                        <TD className="font-medium">{i.item_name_snapshot}</TD>
                        <TD className="text-ink-muted">{i.consignee ?? '—'}</TD>
                        <TD align="right">{qty(i.sold_quantity)}</TD>
                        <TD align="right">{peso(i.unit_price)}</TD>
                        <TD align="right" className="font-medium">{peso(i.sales_amount)}</TD>
                        <TD align="right">{qty(i.unsold_quantity)}</TD>
                        <TD align="right">{peso(i.unsold_amount)}</TD>
                        <TD align="right" className="text-brand-700">{peso(i.canteen_share)}</TD>
                        <TD align="right" className="text-gold-600">{i.is_canteen_stock ? '—' : peso(i.remit_amount)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-6 bg-brand-50/60 px-5 py-3 text-sm font-semibold">
              <span>Units sold: {qty(grand.sold)}</span>
              <span>Sales: {peso(grand.amount)}</span>
              <span>Unsold: {qty(grand.unsold)} ({peso(grand.unsold_amount)})</span>
              <span>Canteen share: {peso(grand.canteen_share)}</span>
              <span>Remit: {peso(grand.remit)}</span>
            </div>
          </div>
        )}
      </Card>
      <PrintableReport report={days.length ? report() : null} />
    </>
  );
}

// ----------------------------------------- D. Expenses & other sales report
export function ExpensesReport({ filters }: { filters: ReportFilters }) {
  const { start, end } = filters.period;
  const { activeSchoolYear } = useApp();
  const { data = [], isLoading, error, refetch } = useFinancialTxns({
    start,
    end,
    type: filters.type || undefined,
    categoryId: filters.categoryId || undefined,
    status: 'posted',
    search: filters.item.trim() || undefined,
  });
  const totals = useMemo(() => {
    const by = (t: string, inc?: boolean) => data.filter((r) => r.transaction_type === t && (inc === undefined || r.included_in_daily_sales === inc)).reduce((a, r) => a + toNumber(r.amount), 0);
    return { sale: by('sale', false), included: by('sale', true), expense: by('expense'), deficit: by('deficit') };
  }, [data]);
  const report = (): OfficialReport => ({
    title: 'Expenses and Other Sales Report',
    period: describePeriod(start, end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Expenses-Other-Sales-Report-${start}_${end}`,
    orientation: 'landscape',
    columns: [
      { key: 'no', header: 'No.', width: 6 },
      { key: 'transaction_date', header: 'Date', format: 'date', width: 14 },
      { key: 'description', header: 'Item / Description', width: 30 },
      { key: 'type', header: 'Transaction Type', width: 14 },
      { key: 'category_name', header: 'Nature of Item', width: 20 },
      { key: 'requested_by', header: 'Requested By / Received From', width: 22 },
      { key: 'amount', header: 'Amount', format: 'peso', width: 14 },
    ],
    rows: data.map((r, i) => ({ ...r, no: i + 1, type: FIN_TYPE_LABEL[r.transaction_type] + (r.included_in_daily_sales ? '*' : '') })),
    summary: [
      { label: 'Total sales (other shares)', value: peso(totals.sale) },
      { label: 'Total expenses', value: peso(totals.expense) },
      { label: 'Total deficit', value: peso(totals.deficit) },
    ],
    notes: totals.included ? [`* Sale already included in a daily sales record (${peso(totals.included)}); listed but not added to Other Shares.`] : undefined,
  });
  return (
    <>
      <Card className="no-print">
        <CardHeader title="D. Expenses and Other Sales Report" description="Posted transactions; use the filters for daily, monthly, quarterly or custom ranges" icon={<Receipt />} actions={<ExportMenu report={report} disabled={data.length === 0} />} />
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : data.length === 0 ? (
          <EmptyState icon={<Receipt />} title="No transactions match the filters" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Item / description</TH>
                <TH>Type</TH>
                <TH>Nature of item</TH>
                <TH>Requested by / received from</TH>
                <TH align="right">Amount</TH>
              </tr>
            </THead>
            <tbody>
              {data.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{formatDate(r.transaction_date)}</TD>
                  <TD className="font-medium">
                    {r.description}
                    {r.included_in_daily_sales && <Badge className="ml-2">In daily sales</Badge>}
                  </TD>
                  <TD><TypeBadge type={r.transaction_type} /></TD>
                  <TD className="text-ink-muted">{r.category_name ?? '—'}</TD>
                  <TD className="text-ink-muted">{r.requested_by ?? '—'}</TD>
                  <TD align="right" className="font-semibold">{peso(r.amount)}</TD>
                </TR>
              ))}
            </tbody>
            <tfoot className="bg-surface-page text-sm font-semibold">
              <tr><TD colSpan={5} className="text-right">Sales (other shares)</TD><TD align="right" className="text-brand-700">{peso(totals.sale)}</TD></tr>
              <tr><TD colSpan={5} className="text-right">Expenses</TD><TD align="right">{peso(totals.expense)}</TD></tr>
              <tr><TD colSpan={5} className="text-right">Deficit</TD><TD align="right" className="text-danger-600">{peso(totals.deficit)}</TD></tr>
            </tfoot>
          </Table>
        )}
      </Card>
      <PrintableReport report={data.length ? report() : null} />
    </>
  );
}

// ------------------------------------------------------- E. Inventory report
export function InventoryReport({ filters }: { filters: ReportFilters }) {
  const { start, end } = filters.period;
  const { activeSchoolYear } = useApp();
  const { data = [], isLoading, error, refetch } = useInventoryMovement(start, end);
  const { data: inv = [] } = useInventory(true);
  const catOf = useMemo(() => new Map(inv.map((i) => [i.id, i.category_id])), [inv]);
  const { data: adjustments = [] } = useQuery({
    queryKey: ['reports', 'adjustments', start, end],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('inventory_transactions')
          .select('*, inventory_items(name, unit)')
          .in('transaction_type', ['damaged', 'expired', 'spoiled', 'missing', 'count_correction', 'other_adjustment', 'stock_in_reversal', 'sale_reversal'])
          .gte('txn_date', start)
          .lte('txn_date', end)
          .order('txn_date', { ascending: false }),
      ) as (InventoryTxn & { inventory_items: { name: string; unit: string } })[],
  });
  const rows = data.filter(
    (r) =>
      (r.is_active || toNumber(r.closing) !== 0) &&
      (!filters.item || r.item_name.toLowerCase().includes(filters.item.toLowerCase())) &&
      (!filters.invCategoryId || catOf.get(r.item_id) === filters.invCategoryId),
  );
  const value = rows.reduce((a, r) => a + toNumber(r.stock_value), 0);
  const low = rows.filter((r) => r.is_active && r.stock_status === 'low_stock');
  const out = rows.filter((r) => r.is_active && r.stock_status === 'out_of_stock');
  const report = (): OfficialReport => ({
    title: 'Inventory Report',
    period: describePeriod(start, end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Inventory-Report-${start}_${end}`,
    orientation: 'landscape',
    columns: [
      { key: 'item_code', header: 'Code', width: 10 },
      { key: 'item_name', header: 'Item', width: 24 },
      { key: 'unit', header: 'Unit', width: 8 },
      { key: 'opening', header: 'Opening', format: 'qty', width: 9 },
      { key: 'received', header: 'Received', format: 'qty', width: 9 },
      { key: 'sold', header: 'Sold', format: 'qty', width: 9 },
      { key: 'losses', header: 'Damaged / Expired', format: 'qty', width: 10 },
      { key: 'other_adjustments', header: 'Adjustments', format: 'qty', width: 10 },
      { key: 'closing', header: 'Closing', format: 'qty', width: 9 },
      { key: 'quantity_on_hand', header: 'Current', format: 'qty', width: 9 },
      { key: 'stock_value', header: 'Stock Value', format: 'peso', width: 13 },
      { key: 'status', header: 'Status', width: 11 },
    ],
    rows: rows.map((r) => ({ ...r, status: STOCK_STATUS_LABEL[r.stock_status] })),
    totals: { item_name: 'TOTAL', stock_value: value },
    sections: adjustments.length
      ? [{
          title: 'Inventory adjustments',
          columns: [
            { key: 'txn_date', header: 'Date', format: 'date' },
            { key: 'item', header: 'Item' },
            { key: 'type', header: 'Type' },
            { key: 'quantity', header: 'Qty', format: 'qty' },
            { key: 'reason', header: 'Reason' },
          ],
          rows: adjustments.map((a) => ({ ...a, item: a.inventory_items.name, type: INV_TYPE_LABEL[a.transaction_type] })),
        }]
      : undefined,
    summary: [
      { label: 'Total stock value (current)', value: peso(value), emphasis: true },
      { label: 'Low-stock items', value: String(low.length) },
      { label: 'Out-of-stock items', value: String(out.length) },
    ],
  });
  return (
    <>
      <div className="no-print space-y-6">
        <Card>
          <CardHeader
            title="E. Inventory Report"
            description="Opening + received − sold − losses ± adjustments = closing (current quantity and value as of today)"
            icon={<Boxes />}
            actions={<ExportMenu report={report} disabled={rows.length === 0} />}
          />
          {error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <TableSkeleton cols={10} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Boxes />} title="No inventory items" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH align="right">Opening</TH>
                  <TH align="right">Received</TH>
                  <TH align="right">Sold</TH>
                  <TH align="right">Damaged / expired</TH>
                  <TH align="right">Adjustments</TH>
                  <TH align="right">Closing</TH>
                  <TH align="right">Current</TH>
                  <TH align="right">Stock value</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.item_id}>
                    <TD>
                      <div className="font-medium">{r.item_name}</div>
                      <div className="font-mono text-[11px] text-ink-muted">{r.item_code}</div>
                    </TD>
                    <TD align="right">{qty(r.opening)}</TD>
                    <TD align="right" className="text-brand-600">{qty(r.received)}</TD>
                    <TD align="right">{qty(r.sold)}</TD>
                    <TD align="right" className={toNumber(r.losses) ? 'text-danger-600' : ''}>{qty(r.losses)}</TD>
                    <TD align="right">{qty(r.other_adjustments)}</TD>
                    <TD align="right" className="font-semibold">{qty(r.closing)}</TD>
                    <TD align="right">
                      {qty(r.quantity_on_hand)}
                      {!r.reconciled && <div className="text-[11px] text-danger-600">ledger mismatch</div>}
                    </TD>
                    <TD align="right">{peso(r.stock_value)}</TD>
                    <TD>{r.is_active ? <StockBadge status={r.stock_status} /> : <Badge>Archived</Badge>}</TD>
                  </TR>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-page font-semibold">
                  <TD colSpan={8}>Total stock value</TD>
                  <TD align="right">{peso(value)}</TD>
                  <TD />
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Inventory adjustments in period" description="Damaged, expired, spoiled, missing, count corrections, reversals" />
          {adjustments.length === 0 ? (
            <EmptyState icon={<Boxes />} title="No adjustments recorded" className="py-8" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Item</TH>
                  <TH>Type</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Value</TH>
                  <TH>Reason</TH>
                </tr>
              </THead>
              <tbody>
                {adjustments.map((a) => (
                  <TR key={a.id}>
                    <TD>{formatDate(a.txn_date)}</TD>
                    <TD className="font-medium">{a.inventory_items.name}</TD>
                    <TD>
                      {INV_TYPE_LABEL[a.transaction_type]}
                      {a.is_exception && <Badge tone="red" className="ml-2">Exception</Badge>}
                    </TD>
                    <TD align="right" className={toNumber(a.quantity) < 0 ? 'text-danger-600' : 'text-brand-600'}>{qty(a.quantity)}</TD>
                    <TD align="right">{peso(Math.abs(toNumber(a.quantity)) * toNumber(a.unit_cost))}</TD>
                    <TD className="max-w-[320px] text-ink-muted">{a.reason}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      <PrintableReport report={rows.length ? report() : null} />
    </>
  );
}
