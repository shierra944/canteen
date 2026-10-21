import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { CHART } from '@/components/shared';
import { eachDay, monthKey, weekKey } from '@/lib/periods';
import { formatDate, parseISODate, peso, pesoCompact, toNumber } from '@/lib/utils';
import type { DailySummaryRow } from '@/lib/types';

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface SeriesPoint {
  key: string;
  label: string;
  gross: number;
  expenses: number;
  deficit: number;
  net: number;
  salesAmount: number;
}

/** Bucket the server-calculated daily rows; totals are sums of database values. */
export function bucketSeries(rows: DailySummaryRow[], start: string, end: string, g: Granularity): SeriesPoint[] {
  const keyOf = g === 'daily' ? (d: string) => d : g === 'weekly' ? weekKey : monthKey;
  const map = new Map<string, SeriesPoint>();
  const days = eachDay(start, end);
  const keysInOrder = days.length <= 800 ? [...new Set(days.map(keyOf))] : [];
  for (const k of keysInOrder) map.set(k, emptyPoint(k, g));
  for (const r of rows) {
    const k = keyOf(r.report_date);
    const p = map.get(k) ?? emptyPoint(k, g);
    p.gross += toNumber(r.gross_sales);
    p.expenses += toNumber(r.expenses);
    p.deficit += toNumber(r.deficit);
    p.net += toNumber(r.net_sales);
    p.salesAmount += toNumber(r.sales_amount);
    map.set(k, p);
  }
  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({ ...p, gross: r2(p.gross), expenses: r2(p.expenses), net: r2(p.net), deficit: r2(p.deficit), salesAmount: r2(p.salesAmount) }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function emptyPoint(key: string, g: Granularity): SeriesPoint {
  const d = parseISODate(key);
  const label =
    g === 'monthly'
      ? new Intl.DateTimeFormat('en-PH', { month: 'short', year: '2-digit' }).format(d)
      : g === 'weekly'
        ? `Wk ${formatDate(key, 'short')}`
        : formatDate(key, 'short');
  return { key, label, gross: 0, expenses: 0, deficit: 0, net: 0, salesAmount: 0 };
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[180px] rounded-xl border border-surface-border bg-surface px-3.5 py-2.5 shadow-raised">
      <div className="mb-1.5 text-xs font-semibold text-ink">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey as string} className="flex items-center justify-between gap-4 py-0.5 text-xs">
          <span className="flex items-center gap-2 text-ink-muted">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular font-medium text-ink">{peso(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.dashed ? (
            <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
          ) : (
            <span className="h-2 w-4 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

const axisProps = {
  tick: { fill: CHART.axis, fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

export function FinancialOverviewChart({ data }: { data: SeriesPoint[] }) {
  const hasData = useMemo(() => data.some((d) => d.gross || d.expenses || d.net), [data]);
  if (!hasData) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.sales} stopOpacity={0.18} />
            <stop offset="100%" stopColor={CHART.sales} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.expenses} stopOpacity={0.14} />
            <stop offset="100%" stopColor={CHART.expenses} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={64} tickFormatter={(v) => pesoCompact(v).replace('.00', '')} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }} />
        <Area type="monotone" dataKey="gross" name="Gross sales" stroke={CHART.sales} strokeWidth={2} fill="url(#gSales)" activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        <Area type="monotone" dataKey="expenses" name="Expenses" stroke={CHART.expenses} strokeWidth={2} fill="url(#gExp)" activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        <Line type="monotone" dataKey="net" name="Net sales" stroke={CHART.net} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SalesBarChart({ data, dataKey = 'gross', name = 'Gross sales' }: { data: SeriesPoint[]; dataKey?: keyof SeriesPoint; name?: string }) {
  if (!data.some((d) => toNumber(d[dataKey]) !== 0)) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} width={64} tickFormatter={(v) => pesoCompact(v).replace('.00', '')} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(8,122,53,0.06)' }} />
        <Bar dataKey={dataKey as string} name={name} fill={CHART.sales} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-surface-border text-sm text-ink-muted">
      No finalized sales or transactions in this period.
    </div>
  );
}
