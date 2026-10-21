import { useMemo } from 'react';
import { CalendarDays, Info } from 'lucide-react';
import { useApp } from '@/providers/app';
import { useCarryovers, useDailySummary, useMonthlySummary } from '@/lib/queries';
import { describePeriod } from '@/lib/periods';
import { cn, formatDate, peso, toNumber } from '@/lib/utils';
import type { OfficialReport } from '@/lib/export/report';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import { Badge } from '@/components/ui/badge';
import type { ReportFilters } from './ReportsPage';

export function FormulaNote() {
  const { settings } = useApp();
  const deduct = settings?.deduct_deficit_in_net !== false;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-border px-5 py-3 text-xs text-ink-muted">
      <Info className="size-3.5" />
      <span>Daily Canteen Shares = share quantity × ₱{toNumber(settings?.canteen_share_rate ?? 1).toFixed(2)}</span>
      <span>Gross = Daily Canteen Shares + Other Shares</span>
      <span>Net Sales = Gross − Expenses{deduct ? ' − Deficit' : ''}</span>
      {settings && !settings.formula_confirmed_at && <Badge tone="gold">Formula awaiting administrator confirmation</Badge>}
    </div>
  );
}

const money = (v: unknown, neg = false) => <span className={cn(neg && toNumber(v) < 0 && 'text-danger-600')}>{peso(v)}</span>;

// ------------------------------------------- A. Consolidated daily report
export function ConsolidatedReport({ filters }: { filters: ReportFilters }) {
  const { start, end } = filters.period;
  const { activeSchoolYear } = useApp();
  const { data = [], isLoading, error, refetch } = useDailySummary(start, end);
  const { data: carry = [] } = useCarryovers(start, end);
  const t = useMemo(() => {
    const s = (k: keyof (typeof data)[number]) => data.reduce((a, r) => a + toNumber(r[k]), 0);
    return {
      actual_money: s('actual_money'),
      daily_canteen_shares: s('daily_canteen_shares'),
      other_shares: s('other_shares'),
      gross_sales: s('gross_sales'),
      expenses: s('expenses'),
      deficit: s('deficit'),
      net_sales: s('net_sales'),
    };
  }, [data]);
  const carryTotal = carry.filter((c) => c.status === 'posted').reduce((a, c) => a + toNumber(c.amount), 0);

  const report = (): OfficialReport => ({
    title: 'Consolidated Daily Canteen Report',
    period: describePeriod(start, end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Consolidated-Daily-${start}_${end}`,
    columns: [
      { key: 'no', header: 'No.', width: 6 },
      { key: 'report_date', header: 'Date', format: 'date', width: 14 },
      { key: 'actual_money', header: 'Actual Money', format: 'peso', width: 14 },
      { key: 'daily_canteen_shares', header: 'Daily Canteen Shares', format: 'peso', width: 14 },
      { key: 'other_shares', header: 'Other Shares', format: 'peso', width: 13 },
      { key: 'gross_sales', header: 'Gross Sales', format: 'peso', width: 13 },
      { key: 'expenses', header: 'Expenses', format: 'peso', width: 13 },
      { key: 'deficit', header: 'Deficit', format: 'peso', width: 12 },
      { key: 'net_sales', header: 'Net Sales', format: 'peso', width: 13 },
    ],
    rows: data.map((r, i) => ({ ...r, no: i + 1 })),
    totals: { report_date: 'TOTAL', ...t },
    summary: [
      ...carry.filter((c) => c.status === 'posted').map((c) => ({ label: c.description, value: peso(c.amount) })),
      { label: 'Daily Canteen Share', value: peso(t.daily_canteen_shares) },
      { label: 'Other Shares', value: peso(t.other_shares) },
      { label: 'Expenses', value: peso(t.expenses) },
      { label: 'Deficit', value: peso(t.deficit) },
      { label: 'Gross Sales', value: peso(t.gross_sales), emphasis: true },
      { label: 'Net Sales', value: peso(t.net_sales), emphasis: true },
      ...(carryTotal ? [{ label: 'Remaining Money (Net Sales + carry-overs)', value: peso(t.net_sales + carryTotal), emphasis: true }] : []),
    ],
  });

  return (
    <>
      <Card className="no-print">
        <CardHeader
          title="A. Consolidated Daily Canteen Report"
          description="Workbook SUMMARY sheet — one row per reporting date"
          icon={<CalendarDays />}
          actions={<ExportMenu report={report} disabled={data.length === 0} />}
        />
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton cols={9} />
        ) : data.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="No finalized records in this period" description="Only finalized daily sales and posted transactions are included." />
        ) : (
          <div className="grid gap-0 xl:grid-cols-[1fr_300px]">
            <Table>
              <THead>
                <tr>
                  <TH>No.</TH>
                  <TH>Date</TH>
                  <TH align="right">Actual money</TH>
                  <TH align="right">Daily canteen shares</TH>
                  <TH align="right">Other shares</TH>
                  <TH align="right">Gross sales</TH>
                  <TH align="right">Expenses</TH>
                  <TH align="right">Deficit</TH>
                  <TH align="right">Net sales</TH>
                </tr>
              </THead>
              <tbody>
                {data.map((r, i) => (
                  <TR key={r.report_date}>
                    <TD className="text-ink-muted">{i + 1}</TD>
                    <TD className="whitespace-nowrap font-medium">
                      {formatDate(r.report_date)}
                      {!r.has_daily_sale && <div className="text-[11px] font-normal text-ink-muted">No finalized daily sales</div>}
                    </TD>
                    <TD align="right">{r.actual_money === null ? '—' : peso(r.actual_money)}</TD>
                    <TD align="right">{peso(r.daily_canteen_shares)}</TD>
                    <TD align="right">{peso(r.other_shares)}</TD>
                    <TD align="right" className="font-semibold text-brand-700">{peso(r.gross_sales)}</TD>
                    <TD align="right">{peso(r.expenses)}</TD>
                    <TD align="right" className={toNumber(r.deficit) ? 'text-danger-600' : ''}>{peso(r.deficit)}</TD>
                    <TD align="right" className="font-semibold">{money(r.net_sales, true)}</TD>
                  </TR>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-surface-border bg-surface-page font-semibold">
                  <TD colSpan={2}>Total ({data.length} days)</TD>
                  <TD align="right">{peso(t.actual_money)}</TD>
                  <TD align="right">{peso(t.daily_canteen_shares)}</TD>
                  <TD align="right">{peso(t.other_shares)}</TD>
                  <TD align="right" className="text-brand-700">{peso(t.gross_sales)}</TD>
                  <TD align="right">{peso(t.expenses)}</TD>
                  <TD align="right">{peso(t.deficit)}</TD>
                  <TD align="right">{money(t.net_sales, true)}</TD>
                </tr>
              </tfoot>
            </Table>
            <div className="border-t border-surface-border bg-surface-page/60 p-5 xl:border-l xl:border-t-0">
              <div className="label-caps mb-3">Summary</div>
              <dl className="space-y-2 text-sm">
                {carry.filter((c) => c.status === 'posted').map((c) => (
                  <Row key={c.id} label={c.description} value={peso(c.amount)} />
                ))}
                <Row label="Daily Canteen Share" value={peso(t.daily_canteen_shares)} />
                <Row label="Other Shares" value={peso(t.other_shares)} />
                <Row label="Expenses" value={peso(t.expenses)} />
                <Row label="Deficit" value={peso(t.deficit)} />
                <div className="border-t border-surface-border pt-2" />
                <Row label="Gross Sales" value={peso(t.gross_sales)} strong />
                <Row label="Net Sales" value={money(t.net_sales, true)} strong />
                {carryTotal > 0 && <Row label="Remaining Money" value={money(t.net_sales + carryTotal, true)} strong hint="Net Sales + carry-overs" />}
              </dl>
            </div>
          </div>
        )}
        <FormulaNote />
      </Card>
      <PrintableReport report={data.length ? report() : null} />
    </>
  );
}

function Row({ label, value, strong, hint }: { label: string; value: React.ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn('text-ink-muted', strong && 'font-semibold text-ink')}>
        {label}
        {hint && <span className="block text-[11px] font-normal text-ink-soft">{hint}</span>}
      </dt>
      <dd className={cn('tabular', strong ? 'font-semibold' : 'font-medium')}>{value}</dd>
    </div>
  );
}

// ------------------------------------------------- B. Monthly canteen report
export function MonthlyReport({ filters }: { filters: ReportFilters }) {
  const { start, end } = filters.period;
  const { data = [], isLoading, error, refetch } = useMonthlySummary(start, end);
  const t = useMemo(() => {
    const s = (k: keyof (typeof data)[number]) => data.reduce((a, r) => a + toNumber(r[k]), 0);
    return {
      actual_money: s('actual_money'),
      daily_canteen_shares: s('daily_canteen_shares'),
      other_shares: s('other_shares'),
      gross_sales: s('gross_sales'),
      expenses: s('expenses'),
      deficit: s('deficit'),
      net_sales: s('net_sales'),
    };
  }, [data]);
  const monthLabel = (d: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(new Date(d + 'T00:00'));
  const report = (): OfficialReport => ({
    title: 'Monthly Canteen Report',
    period: describePeriod(start, end),
    schoolYear: data[0]?.school_year ?? undefined,
    filename: `QNHS-Monthly-Canteen-${start}_${end}`,
    columns: [
      { key: 'no', header: 'No.', width: 6 },
      { key: 'month', header: 'Month', width: 16 },
      { key: 'school_year', header: 'School Year', width: 12 },
      { key: 'actual_money', header: 'Total Actual Money', format: 'peso', width: 15 },
      { key: 'daily_canteen_shares', header: 'Total Daily Canteen Shares', format: 'peso', width: 15 },
      { key: 'other_shares', header: 'Total Other Shares', format: 'peso', width: 14 },
      { key: 'gross_sales', header: 'Total Gross Sales', format: 'peso', width: 14 },
      { key: 'expenses', header: 'Total Expenses', format: 'peso', width: 14 },
      { key: 'deficit', header: 'Total Deficit', format: 'peso', width: 13 },
      { key: 'net_sales', header: 'Total Net Sales', format: 'peso', width: 14 },
    ],
    rows: data.map((r, i) => ({ ...r, no: i + 1, month: monthLabel(r.month_start) })),
    totals: { month: 'TOTAL', ...t },
  });
  return (
    <>
      <Card className="no-print">
        <CardHeader
          title="B. Monthly Canteen Report"
          description="Months within the selected period. Choose a school year above to see the whole year. Original records are never modified."
          actions={<ExportMenu report={report} disabled={data.length === 0} />}
        />
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton cols={9} />
        ) : data.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="No data for this period" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Month</TH>
                <TH>School year</TH>
                <TH align="right">Days</TH>
                <TH align="right">Actual money</TH>
                <TH align="right">Daily canteen shares</TH>
                <TH align="right">Other shares</TH>
                <TH align="right">Gross sales</TH>
                <TH align="right">Expenses</TH>
                <TH align="right">Deficit</TH>
                <TH align="right">Net sales</TH>
              </tr>
            </THead>
            <tbody>
              {data.map((r) => (
                <TR key={r.month_start}>
                  <TD className="font-medium">{monthLabel(r.month_start)}</TD>
                  <TD className="text-ink-muted">{r.school_year ?? '—'}</TD>
                  <TD align="right">{r.days_reported}</TD>
                  <TD align="right">{peso(r.actual_money)}</TD>
                  <TD align="right">{peso(r.daily_canteen_shares)}</TD>
                  <TD align="right">{peso(r.other_shares)}</TD>
                  <TD align="right" className="font-semibold text-brand-700">{peso(r.gross_sales)}</TD>
                  <TD align="right">{peso(r.expenses)}</TD>
                  <TD align="right">{peso(r.deficit)}</TD>
                  <TD align="right" className="font-semibold">{money(r.net_sales, true)}</TD>
                </TR>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-surface-border bg-surface-page font-semibold">
                <TD colSpan={3}>Total</TD>
                <TD align="right">{peso(t.actual_money)}</TD>
                <TD align="right">{peso(t.daily_canteen_shares)}</TD>
                <TD align="right">{peso(t.other_shares)}</TD>
                <TD align="right">{peso(t.gross_sales)}</TD>
                <TD align="right">{peso(t.expenses)}</TD>
                <TD align="right">{peso(t.deficit)}</TD>
                <TD align="right">{money(t.net_sales, true)}</TD>
              </tr>
            </tfoot>
          </Table>
        )}
        <FormulaNote />
      </Card>
      <PrintableReport report={data.length ? report() : null} />
    </>
  );
}
