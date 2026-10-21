import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CircleCheck,
  PhilippinePeso,
  PackageX,
  Receipt,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { useAlerts, useDailySummary, useDashboardMetrics, useInventory, useMoneyOnHand } from '@/lib/queries';
import { supabase, unwrap } from '@/lib/supabase';
import { resolvePeriod, describePeriod, type Period } from '@/lib/periods';
import { formatDate, peso, qty, toNumber } from '@/lib/utils';
import { LEDGER_KIND_LABEL } from '@/lib/labels';
import type { LedgerRow } from '@/lib/types';
import { NewSaleButton } from '@/pages/daily-sales/NewSaleButton';
import { PeriodPicker, StatCard, CHART } from '@/components/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge, StockBadge } from '@/components/ui/badge';
import { Callout, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { AlertDot } from '@/components/layout/Topbar';
import { bucketSeries, FinancialOverviewChart, Legend, SalesBarChart, type Granularity } from './charts';
import { DashboardDetail, type DashboardDetailKind } from './details';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-PH', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { profile, can } = useAuth();
  const { workingDate, activeSchoolYear } = useApp();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('this_month', workingDate));
  const [gran, setGran] = useState<Granularity>('daily');
  const [detail, setDetail] = useState<DashboardDetailKind | null>(null);
  const finance = can('reports.view') || can('sales.record') || can('finance.record');

  const metrics = useDashboardMetrics(period.start, period.end);
  const daily = useDailySummary(period.start, period.end, finance);
  const m = metrics.data;
  const series = useMemo(() => bucketSeries(daily.data ?? [], period.start, period.end, gran), [daily.data, period, gran]);
  const dailySeries = useMemo(() => bucketSeries(daily.data ?? [], period.start, period.end, 'daily'), [daily.data, period]);

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const net = toNumber(m?.net_sales);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight text-ink">
            {greeting()}, {firstName}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Here's your canteen's financial and inventory overview.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <PeriodPicker value={period} onChange={setPeriod} />
          <span className="text-xs text-ink-muted">
            {describePeriod(period.start, period.end)}
            {activeSchoolYear ? ` · SY ${activeSchoolYear.name}` : ''}
          </span>
        </div>
      </div>

      {m && !m.formula_confirmed && can('settings.manage') && (
        <Callout
          tone="gold"
          title="Confirm the financial reporting formula"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/settings?tab=financial">Review</Link>
            </Button>
          }
        >
          Figures follow the workbook formula (Net Sales = Gross − Expenses{m.deduct_deficit_in_net ? ' − Deficit' : ''}). An administrator should confirm it before reports are signed.
        </Callout>
      )}

      {finance && <MoneyOnHandCard />}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.isLoading || !m ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
        ) : (
          <>
            <StatCard
              label="Total Gross Sales"
              value={peso(m.gross_sales)}
              icon={<TrendingUp />}
              tone="positive"
              sub={<>Canteen shares {peso(m.daily_canteen_shares)} + other shares {peso(m.other_shares)}</>}
              onClick={finance ? () => setDetail('gross') : undefined}
            />
            <StatCard label="Total Expenses" value={peso(m.expenses)} icon={<Receipt />} sub={<>Deficits recorded separately: {peso(m.deficit)}</>} onClick={finance ? () => setDetail('expenses') : undefined} />
            <StatCard
              label="Other Sales"
              value={peso(m.other_shares)}
              icon={<PhilippinePeso />}
              sub={
                toNumber(m.included_sales) > 0
                  ? `${peso(m.included_sales)} already in daily sales — not counted again`
                  : 'Separately recorded sales only'
              }
              onClick={finance ? () => setDetail('other') : undefined}
            />
            <StatCard
              label="Net Sales"
              value={peso(net)}
              icon={<Scale />}
              tone={net < 0 ? 'negative' : 'positive'}
              sub={`Gross − Expenses${m.deduct_deficit_in_net ? ' − Deficit' : ''} (sales balance, not profit)`}
              onClick={finance ? () => setDetail('net') : undefined}
            />
          </>
        )}
      </div>

      {finance && (
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Financial overview"
              description="Gross sales, expenses and net sales from finalized records"
              actions={
                <div className="flex rounded-lg border border-surface-border p-0.5">
                  {(['daily', 'weekly', 'monthly'] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGran(g)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${gran === g ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:text-ink'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              }
            />
            <CardBody>
              <div className="mb-3">
                <Legend
                  items={[
                    { label: 'Gross sales', color: CHART.sales },
                    { label: 'Expenses', color: CHART.expenses },
                    { label: 'Net sales', color: CHART.net, dashed: true },
                  ]}
                />
              </div>
              {daily.isLoading ? <Skeleton className="h-[300px]" /> : <FinancialOverviewChart data={series} />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Sales performance" description="Gross sales per day — compare dates" />
            <CardBody>{daily.isLoading ? <Skeleton className="h-[260px]" /> : <SalesBarChart data={dailySeries} />}</CardBody>
          </Card>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <InventoryStatusCard />
        <AlertsCard />
      </div>

      {finance && <RecentTransactions />}

      <DashboardDetail kind={detail} start={period.start} end={period.end} metrics={m} onClose={() => setDetail(null)} />
    </div>
  );
}

/** All-time cash position — ignores the period picker on purpose. */
function MoneyOnHandCard() {
  const { data, isLoading } = useMoneyOnHand();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {isLoading || !data ? (
        <Skeleton className="h-[132px] rounded-2xl" />
      ) : (
        <StatCard
          label="Money on hand"
          value={peso(data.total)}
          icon={<Banknote />}
          tone={data.total < 0 ? 'negative' : 'positive'}
          sub={
            <>
              As of today · carry-over {peso(data.carryover)} + gross sales {peso(data.gross)} − expenses {peso(data.expenses)} − deficits {peso(data.deficit)}
              {data.fundSpent > 0 && <> − fund spending {peso(data.fundSpent)}</>}
            </>
          }
        />
      )}
    </div>
  );
}

function InventoryStatusCard() {
  const { data: allItems = [], isLoading } = useInventory();
  const items = allItems.filter((i) => !i.is_consigned);
  const counts = {
    in_stock: items.filter((i) => i.stock_status === 'in_stock').length,
    low_stock: items.filter((i) => i.stock_status === 'low_stock').length,
    out_of_stock: items.filter((i) => i.stock_status === 'out_of_stock').length,
  };
  const attention = items
    .filter((i) => i.stock_status !== 'in_stock')
    .sort((a, b) => toNumber(a.quantity_on_hand) - toNumber(b.quantity_on_hand))
    .slice(0, 6);
  const total = items.length || 1;
  return (
    <Card>
      <CardHeader
        title="Inventory status"
        icon={<Boxes />}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/inventory">
              View all <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardBody>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : items.length === 0 ? (
          <EmptyState icon={<Boxes />} title="No canteen stock items yet" description="Add canteen-owned products to track stock. Consigned items are not stock-tracked." className="py-6" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {([
                ['in_stock', 'In stock', 'text-brand-600', 'bg-brand-500'],
                ['low_stock', 'Low stock', 'text-warn-600', 'bg-warn-500'],
                ['out_of_stock', 'Out of stock', 'text-danger-600', 'bg-danger-500'],
              ] as const).map(([k, label, text, bar]) => (
                <Link key={k} to={`/inventory?status=${k}`} className="rounded-xl border border-surface-border p-3 hover:bg-surface-page">
                  <div className={`tabular text-2xl font-semibold ${text}`}>{counts[k]}</div>
                  <div className="text-xs text-ink-muted">{label}</div>
                  <div className="mt-2 h-1.5 rounded-full bg-surface-sunken">
                    <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${(counts[k] / total) * 100}%` }} />
                  </div>
                </Link>
              ))}
            </div>
            {attention.length > 0 ? (
              <ul className="mt-4 divide-y divide-surface-border">
                {attention.map((i) => (
                  <li key={i.id}>
                    <Link to={`/inventory/${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-700">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{i.name}</span>
                        <span className="text-xs text-ink-muted">
                          {qty(i.quantity_on_hand)} {i.unit} · reorder at {qty(i.reorder_level)}
                        </span>
                      </span>
                      <StockBadge status={i.stock_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm text-brand-700">
                <CircleCheck className="size-4" /> All items are above their reorder levels.
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function AlertsCard() {
  const { data: alerts = [], isLoading } = useAlerts();
  const navigate = useNavigate();
  const order = { critical: 0, warning: 1, info: 2 };
  const sorted = [...alerts].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <Card>
      <CardHeader
        title="Alerts & notifications"
        icon={<AlertTriangle />}
        description="Generated from live records"
        actions={alerts.length > 0 && <Badge tone={alerts.some((a) => a.severity === 'critical') ? 'red' : 'amber'}>{alerts.length}</Badge>}
      />
      {isLoading ? (
        <CardBody>
          <Skeleton className="h-40" />
        </CardBody>
      ) : sorted.length === 0 ? (
        <EmptyState icon={<CircleCheck />} title="No alerts" description="Stock levels, daily reports and balances look fine." className="py-10" />
      ) : (
        <ul className="scrollbar-thin max-h-[380px] divide-y divide-surface-border overflow-y-auto">
          {sorted.slice(0, 40).map((a) => (
            <li key={a.alert_key}>
              <button onClick={() => a.link && navigate(a.link)} className="flex w-full gap-3 px-5 py-3 text-left hover:bg-surface-page">
                <AlertDot alert={a} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{a.title}</span>
                  <span className="block text-xs leading-relaxed text-ink-muted">{a.message}</span>
                </span>
                {a.occurred_on && <span className="shrink-0 text-[11px] text-ink-soft">{formatDate(a.occurred_on, 'short')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentTransactions() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ['ledger', 'recent'],
    queryFn: async () => unwrap(await supabase.from('v_transaction_ledger').select('*').order('created_at', { ascending: false }).limit(8)) as LedgerRow[],
  });
  return (
    <Card>
      <CardHeader
        title="Recent transactions"
        icon={<PhilippinePeso />}
        actions={
          <>
            {can('sales.record') && (
              <NewSaleButton size="sm" variant="secondary">
                Daily sales
              </NewSaleButton>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/transactions">
                View all <ArrowRight />
              </Link>
            </Button>
          </>
        }
      />
      {isLoading ? (
        <CardBody>
          <Skeleton className="h-40" />
        </CardBody>
      ) : data.length === 0 ? (
        <EmptyState icon={<PackageX />} title="No transactions yet" description="Recorded sales, expenses and stock movements will appear here." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Description</TH>
              <TH align="right">Amount</TH>
              <TH>Recorded by</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {data.map((r) => (
              <TR key={r.kind + r.id} onClick={() => r.link && navigate(r.link)}>
                <TD className="whitespace-nowrap text-ink-muted">{formatDate(r.txn_date)}</TD>
                <TD className="whitespace-nowrap">{LEDGER_KIND_LABEL[r.kind] ?? r.kind}</TD>
                <TD className="max-w-[360px] truncate">{r.description}</TD>
                <TD align="right" className="font-medium">
                  {r.amount !== null ? peso(r.amount) : '—'}
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">{r.created_by_name ?? '—'}</TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
