import { useMemo } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useApp } from '@/providers/app';
import { useDailySummary, useExpenseBreakdown, useMonthlySummary } from '@/lib/queries';
import { describePeriod } from '@/lib/periods';
import { peso, toNumber } from '@/lib/utils';
import type { OfficialReport } from '@/lib/export/report';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { CHART } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import { bucketSeries, FinancialOverviewChart, Legend } from '@/pages/dashboard/charts';
import { FormulaNote } from './SummaryReports';
import type { ReportFilters } from './ReportsPage';

export function FinancialSummaryReport({ filters }: { filters: ReportFilters }) {
  const { start, end } = filters.period;
  const { settings, activeSchoolYear } = useApp();
  const daily = useDailySummary(start, end);
  const monthly = useMonthlySummary(start, end);
  const breakdown = useExpenseBreakdown(start, end);
  const rows = daily.data ?? [];
  const t = useMemo(() => {
    const s = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + toNumber(r[k]), 0);
    return {
      shares: s('daily_canteen_shares'),
      other: s('other_shares'),
      gross: s('gross_sales'),
      expenses: s('expenses'),
      deficit: s('deficit'),
      net: s('net_sales'),
      collected: s('sales_amount'),
    };
  }, [rows]);
  const months = monthly.data ?? [];
  const series = useMemo(() => bucketSeries(rows, start, end, months.length > 2 ? 'monthly' : 'daily'), [rows, start, end, months.length]);
  // categories are not used: one line for expenses, one for deficits
  const expenseRows = (['expense', 'deficit'] as const)
    .map((type) => {
      const rows = (breakdown.data ?? []).filter((b) => b.transaction_type === type);
      return {
        transaction_type: type,
        category: type === 'expense' ? 'Expenses' : 'Deficits',
        total: rows.reduce((a, b) => a + toNumber(b.total), 0),
        txn_count: rows.reduce((a, b) => a + toNumber(b.txn_count), 0),
      };
    })
    .filter((b) => b.txn_count > 0);
  const expenseTotal = expenseRows.reduce((a, b) => a + toNumber(b.total), 0);
  const deduct = settings?.deduct_deficit_in_net !== false;

  const report = (): OfficialReport => ({
    title: 'Financial Summary Report',
    period: describePeriod(start, end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Financial-Summary-${start}_${end}`,
    columns: [
      { key: 'label', header: 'Item', width: 40 },
      { key: 'amount', header: 'Amount', format: 'peso', width: 18 },
    ],
    rows: [
      { label: 'Daily Canteen Shares', amount: t.shares },
      { label: 'Other Shares (other sales)', amount: t.other },
      { label: 'TOTAL REVENUE (Gross Sales)', amount: t.gross },
      { label: 'Total Expenses', amount: t.expenses },
      { label: 'Total Deficits', amount: t.deficit },
      { label: `NET SALES (Gross − Expenses${deduct ? ' − Deficit' : ''})`, amount: t.net },
    ],
    sections: [
      {
        title: 'Monthly comparison',
        columns: [
          { key: 'month', header: 'Month' },
          { key: 'gross_sales', header: 'Gross Sales', format: 'peso' },
          { key: 'expenses', header: 'Expenses', format: 'peso' },
          { key: 'deficit', header: 'Deficit', format: 'peso' },
          { key: 'net_sales', header: 'Net Sales', format: 'peso' },
        ],
        rows: months.map((m) => ({ ...m, month: new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(new Date(m.month_start + 'T00:00')) })),
      },
      {
        title: 'Expense and deficit breakdown',
        columns: [
          { key: 'category', header: 'Type' },
          { key: 'txn_count', header: 'Entries', format: 'qty' },
          { key: 'total', header: 'Amount', format: 'peso' },
        ],
        rows: expenseRows,
        totals: { category: 'TOTAL', total: expenseTotal },
      },
    ],
    notes: [
      'Net Sales is a sales balance under the school-approved reporting formula. It is not accounting profit: it does not deduct the cost of goods sold or other costs not recorded as expenses.',
      `Consignment sales collected for vendors during the period: ${peso(t.collected)} (not canteen revenue).`,
    ],
  });

  const loading = daily.isLoading || monthly.isLoading;
  return (
    <>
      <div className="no-print space-y-6">
        <Card>
          <CardHeader title="F. Financial Summary Report" icon={<FileSpreadsheet />} actions={<ExportMenu report={report} disabled={rows.length === 0} />} />
          {loading ? (
            <CardBody>
              <Skeleton className="h-48" />
            </CardBody>
          ) : (
            <CardBody className="grid gap-6 lg:grid-cols-[340px_1fr]">
              <dl className="space-y-2.5 text-sm">
                <Line label="Daily canteen shares" value={t.shares} />
                <Line label="Other shares" value={t.other} />
                <Line label="Total revenue (gross sales)" value={t.gross} strong />
                <Line label="Total expenses" value={-t.expenses} />
                <Line label="Total deficits" value={-t.deficit} note={deduct ? undefined : 'not deducted'} />
                <div className="border-t border-surface-border" />
                <Line label="Net sales (approved formula)" value={t.net} strong />
                <p className="pt-2 text-xs leading-relaxed text-ink-muted">
                  Net Sales is a sales balance, not accounting profit. Consignment collections for vendors ({peso(t.collected)}) are not canteen revenue.
                </p>
              </dl>
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">Revenue trend</div>
                  <Legend items={[{ label: 'Gross sales', color: CHART.sales }, { label: 'Expenses', color: CHART.expenses }, { label: 'Net sales', color: CHART.net, dashed: true }]} />
                </div>
                <FinancialOverviewChart data={series} />
              </div>
            </CardBody>
          )}
          <FormulaNote />
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Monthly comparison" />
            <Table>
              <THead>
                <tr>
                  <TH>Month</TH>
                  <TH align="right">Gross</TH>
                  <TH align="right">Expenses</TH>
                  <TH align="right">Deficit</TH>
                  <TH align="right">Net</TH>
                  <TH align="right">Change</TH>
                </tr>
              </THead>
              <tbody>
                {months.map((m, i) => {
                  const prev = i > 0 ? toNumber(months[i - 1].net_sales) : null;
                  const diff = prev === null ? null : toNumber(m.net_sales) - prev;
                  return (
                    <TR key={m.month_start}>
                      <TD className="font-medium">{new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric' }).format(new Date(m.month_start + 'T00:00'))}</TD>
                      <TD align="right">{peso(m.gross_sales)}</TD>
                      <TD align="right">{peso(m.expenses)}</TD>
                      <TD align="right">{peso(m.deficit)}</TD>
                      <TD align="right" className={toNumber(m.net_sales) < 0 ? 'font-semibold text-danger-600' : 'font-semibold'}>{peso(m.net_sales)}</TD>
                      <TD align="right" className={diff === null ? 'text-ink-muted' : diff < 0 ? 'text-danger-600' : 'text-brand-600'}>
                        {diff === null ? '—' : (diff > 0 ? '+' : '') + peso(diff)}
                      </TD>
                    </TR>
                  );
                })}
                {months.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="py-8 text-center text-ink-muted">No data</TD>
                  </TR>
                )}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Expense breakdown" description="Expenses and deficits" />
            <CardBody className="space-y-3">
              {expenseRows.length === 0 && <div className="py-6 text-center text-sm text-ink-muted">No expenses recorded</div>}
              {expenseRows.map((b) => {
                const pct = expenseTotal ? (toNumber(b.total) / expenseTotal) * 100 : 0;
                return (
                  <div key={b.transaction_type + b.category}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        {b.category}
                        <span className="ml-1.5 text-xs text-ink-muted">({b.txn_count} entries)</span>
                      </span>
                      <span className="tabular font-medium">
                        {peso(b.total)} <span className="text-xs font-normal text-ink-muted">· {pct.toFixed(1)}%</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-sunken">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: b.transaction_type === 'deficit' ? CHART.deficit : CHART.expenses }} />
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>
      </div>
      <PrintableReport report={rows.length ? report() : null} />
    </>
  );
}

function Line({ label, value, strong, note }: { label: string; value: number; strong?: boolean; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold' : 'text-ink-muted'}>
        {label}
        {note && <span className="ml-1 text-xs">({note})</span>}
      </dt>
      <dd className={`tabular ${strong ? 'text-base font-semibold' : 'font-medium'} ${value < 0 && strong ? 'text-danger-600' : ''}`}>{peso(value)}</dd>
    </div>
  );
}
