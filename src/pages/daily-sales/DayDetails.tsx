import { useFinancialTxns } from '@/lib/queries';
import { formatDate, peso, toNumber } from '@/lib/utils';
import type { FinancialTxn, FinTxnType } from '@/lib/types';
import { personLabel } from '@/lib/labels';
import { DetailDialog } from '@/components/DetailDialog';

export type DayDetailKind = 'gross' | 'net' | 'collected' | 'remit' | 'actual';

export interface DayLine {
  item: string;
  consignee: string;
  price: number;
  sold: number;
  sales: number;
  share: number;
  remit: number | null;
  stock: boolean;
}

export interface DayFigures {
  shareTotal: number;
  otherShares: number;
  expenses: number;
  deficit: number;
  gross: number;
  net: number;
  deductDeficit: boolean;
  salesAmount: number;
  remitTotal: number;
  actualMoney: number | null;
}

const txnCols = (type: FinTxnType) => [
  { key: 'description', header: 'Item / description' },
  { key: 'category_name', header: 'Category' },
  { key: 'requested_by', header: personLabel(type) },
  { key: 'amount', header: 'Amount', format: 'peso' as const },
];

/** The lines and transactions behind each figure at the top of the day sheet. */
export function DayDetails({
  kind,
  date,
  lines,
  byConsignee,
  figures,
  onClose,
}: {
  kind: DayDetailKind | null;
  date: string;
  lines: DayLine[];
  byConsignee: { consignee: string; items: number; sold: number; sales: number; share: number; remit: number }[];
  figures: DayFigures;
  onClose: () => void;
}) {
  const open = kind !== null;
  const needsTxns = kind === 'gross' || kind === 'net' || kind === 'actual';
  const { data: txns = [], isLoading } = useFinancialTxns(needsTxns ? { start: date, end: date, status: 'posted' } : { start: '9999-12-31', end: '9999-12-31' });
  const of = (t: string, included?: boolean) => txns.filter((x) => x.transaction_type === t && (included === undefined || x.included_in_daily_sales === included));
  const sum = (list: FinancialTxn[]) => list.reduce((a, x) => a + toNumber(x.amount), 0);
  const day = formatDate(date, 'long');
  const close = (o: boolean) => !o && onClose();
  const f = figures;

  if (kind === 'gross') {
    const other = of('sale', false);
    return (
      <DetailDialog
        open={open}
        onOpenChange={close}
        title="Gross sales (canteen)"
        description={`${day} · canteen shares from this sheet + other sales recorded for the day`}
        loading={isLoading}
        summary={[
          { label: 'Canteen shares (this sheet)', value: peso(f.shareTotal) },
          { label: 'Other shares', value: peso(f.otherShares) },
          { label: 'Gross sales', value: peso(f.gross), strong: true },
        ]}
        sections={[
          {
            title: 'Canteen share per product',
            columns: [
              { key: 'item', header: 'Product' },
              { key: 'consignee', header: 'Consignee', render: (r: DayLine) => (r.stock ? 'Canteen stock' : r.consignee || '—') },
              { key: 'sold', header: 'Sold', format: 'qty' },
              { key: 'sales', header: 'Sales', format: 'peso' },
              { key: 'share', header: 'Canteen share', format: 'peso' },
            ],
            rows: lines,
            totals: { item: 'Total', sales: f.salesAmount, share: f.shareTotal },
            empty: 'No products on the sheet yet.',
          },
          { title: 'Other shares (Expenses & Other Sales)', columns: txnCols('sale'), rows: other, totals: { description: 'Total', amount: sum(other) }, empty: 'No other sales recorded for this day.' },
        ]}
        link={{ to: '/finance', label: 'Open Expenses & Other Sales' }}
      />
    );
  }

  if (kind === 'net') {
    const exp = of('expense');
    const def = of('deficit');
    return (
      <DetailDialog
        open={open}
        onOpenChange={close}
        title="Net sales (canteen)"
        description={`${day} · gross sales minus the day's expenses${f.deductDeficit ? ' and deficits' : ''}`}
        loading={isLoading}
        summary={[
          { label: 'Gross sales', value: peso(f.gross) },
          { label: '− Expenses', value: peso(f.expenses) },
          { label: f.deductDeficit ? '− Deficit' : 'Deficit (not deducted)', value: peso(f.deficit) },
          { label: 'Net sales', value: <span className={f.net < 0 ? 'text-danger-600' : ''}>{peso(f.net)}</span>, strong: true },
        ]}
        sections={[
          { title: 'Expenses', columns: txnCols('expense'), rows: exp, totals: { description: 'Total', amount: sum(exp) }, empty: 'No expenses recorded for this day.' },
          { title: 'Deficits', columns: txnCols('deficit'), rows: def, totals: { description: 'Total', amount: sum(def) }, empty: 'No deficits recorded for this day.' },
        ]}
        link={{ to: '/finance', label: 'Open Expenses & Other Sales' }}
      />
    );
  }

  if (kind === 'collected') {
    return (
      <DetailDialog
        open={open}
        onOpenChange={close}
        title="Sales collected"
        description={`${day} · money taken for every product sold (sold × price per piece)`}
        summary={[
          { label: 'Pieces sold', value: lines.reduce((a, l) => a + l.sold, 0) },
          { label: 'Sales collected', value: peso(f.salesAmount), strong: true },
        ]}
        sections={[
          {
            columns: [
              { key: 'item', header: 'Product' },
              { key: 'consignee', header: 'Consignee', render: (r: DayLine) => (r.stock ? 'Canteen stock' : r.consignee || '—') },
              { key: 'price', header: 'Price per piece', format: 'peso' },
              { key: 'sold', header: 'Sold', format: 'qty' },
              { key: 'sales', header: 'Sales', format: 'peso' },
            ],
            rows: [...lines].sort((a, b) => b.sales - a.sales),
            totals: { item: 'Total', sold: lines.reduce((a, l) => a + l.sold, 0), sales: f.salesAmount },
            empty: 'No products on the sheet yet.',
          },
        ]}
      />
    );
  }

  if (kind === 'remit') {
    const consigned = lines.filter((l) => !l.stock);
    return (
      <DetailDialog
        open={open}
        onOpenChange={close}
        title="Money to remit to consignees"
        description={`${day} · sales of consigned products minus the canteen's share`}
        summary={[
          { label: 'Consignees', value: byConsignee.length },
          { label: 'Total to remit', value: peso(f.remitTotal), strong: true },
        ]}
        sections={[
          {
            title: 'Per consignee',
            columns: [
              { key: 'consignee', header: 'Consignee' },
              { key: 'items', header: 'Products', format: 'qty' },
              { key: 'sold', header: 'Pcs sold', format: 'qty' },
              { key: 'sales', header: 'Sales', format: 'peso' },
              { key: 'share', header: 'Canteen share', format: 'peso' },
              { key: 'remit', header: 'To remit', format: 'peso' },
            ],
            rows: byConsignee,
            totals: { consignee: 'Total', remit: f.remitTotal },
            empty: 'No consigned products on the sheet yet.',
          },
          {
            title: 'Per product',
            columns: [
              { key: 'consignee', header: 'Consignee' },
              { key: 'item', header: 'Product' },
              { key: 'sold', header: 'Sold', format: 'qty' },
              { key: 'sales', header: 'Sales', format: 'peso' },
              { key: 'remit', header: 'To remit', format: 'peso' },
            ],
            rows: [...consigned].sort((a, b) => a.consignee.localeCompare(b.consignee)),
          },
        ]}
      />
    );
  }

  if (kind === 'actual') {
    const a = f.actualMoney;
    return (
      <DetailDialog
        open={open}
        onOpenChange={close}
        title="Actual money"
        description={`${day} · cash counted, compared with what the records say was collected`}
        loading={isLoading}
        summary={[
          { label: 'Actual money counted', value: a === null ? 'Not entered yet' : peso(a), strong: true },
          { label: 'Sales collected (sheet)', value: peso(f.salesAmount) },
          { label: '+ Other sales', value: peso(f.otherShares) },
          { label: '− Expenses paid', value: peso(f.expenses) },
          { label: '− Deficit', value: peso(f.deficit) },
          {
            label: 'Difference (actual − expected)',
            value: a === null ? '—' : peso(a - (f.salesAmount + f.otherShares - f.expenses - f.deficit)),
            strong: true,
          },
        ]}
        sections={[]}
      />
    );
  }
  return null;
}
