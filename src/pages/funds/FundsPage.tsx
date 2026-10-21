import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Calculator, FileText, History, MinusCircle, PieChart, Plus, Scale, Trash2, Undo2 } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { rpc } from '@/lib/supabase';
import { keys, useAction, useAllocationRules, useAllocationRuns, useFundCategories, useFundSummary, useFundTxns } from '@/lib/queries';
import { describePeriod, resolvePeriod, type Period } from '@/lib/periods';
import { BASIS_LABEL } from '@/lib/labels';
import { cn, formatDate, peso, toNumber, todayPH, uuid } from '@/lib/utils';
import type { AllocationBasis, AllocationPreview, AllocationRule, FundSummaryRow } from '@/lib/types';
import type { OfficialReport } from '@/lib/export/report';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Callout, EmptyState, Skeleton, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PeriodPicker, ReasonDialog } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';

export default function FundsPage() {
  const { can } = useAuth();
  const { workingDate } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('school_year', workingDate));
  const { activeSchoolYear } = useApp();
  useEffect(() => {
    if (activeSchoolYear && period.key === 'school_year' && period.start !== activeSchoolYear.start_date) {
      setPeriod({ key: 'school_year', start: activeSchoolYear.start_date, end: activeSchoolYear.end_date });
    }
  }, [activeSchoolYear]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: funds = [], isLoading } = useFundSummary(period.start, period.end);
  const [txnDialog, setTxnDialog] = useState<{ open: boolean; fundId?: string }>({ open: false });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Fund Allocation"
          description="Distribution of canteen income to the school funds (workbook TYPE OF FUNDS and SUMMARY allocation table)."
          actions={
            can('funds.manage') && (
              <Button variant="secondary" onClick={() => setTxnDialog({ open: true })}>
                <MinusCircle /> Record fund expenditure
              </Button>
            )
          }
        />
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker value={period} onChange={setPeriod} presets={['this_month', 'this_quarter', 'school_year', 'custom']} />
          <span className="text-xs text-ink-muted">{describePeriod(period.start, period.end)}</span>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="no-print">
          <TabsList className="mb-5">
            <TabsTrigger value="overview" icon={<PieChart />}>Funds</TabsTrigger>
            <TabsTrigger value="allocate" icon={<Calculator />}>Allocation runs</TabsTrigger>
            <TabsTrigger value="ledger" icon={<History />}>Fund ledger</TabsTrigger>
            <TabsTrigger value="rules" icon={<Scale />}>Allocation rules</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
            </div>
          ) : (
            <FundCards funds={funds} onSpend={(id) => setTxnDialog({ open: true, fundId: id })} canManage={can('funds.manage')} />
          )}
        </TabsContent>
        <TabsContent value="allocate">
          <AllocationRuns period={period} />
        </TabsContent>
        <TabsContent value="ledger">
          <FundLedger period={period} funds={funds} />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab />
        </TabsContent>
      </Tabs>
      <FundTxnDialog open={txnDialog.open} fundId={txnDialog.fundId} onOpenChange={(o) => setTxnDialog((s) => ({ ...s, open: o }))} />
    </>
  );
}

function FundCards({ funds, onSpend, canManage }: { funds: FundSummaryRow[]; onSpend: (id: string) => void; canManage: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {funds.map((f) => {
        const allocated = toNumber(f.allocations) + Math.max(0, toNumber(f.adjustments)) + Math.max(0, toNumber(f.opening_balance));
        const used = toNumber(f.expenditures);
        const util = Math.min(100, toNumber(f.utilization_pct));
        return (
          <div key={f.fund_category_id} className="card flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold leading-snug">{f.name}</div>
                <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{f.code}</div>
              </div>
              {f.percentage !== null ? (
                <span className="rounded-lg bg-gold-50 px-2 py-1 text-sm font-semibold text-gold-600 ring-1 ring-inset ring-gold-500/25">{toNumber(f.percentage)}%</span>
              ) : (
                <Badge>{f.is_allocatable ? 'No %' : 'Not allocated'}</Badge>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-[11px] text-ink-muted">Allocated</dt>
                <dd className="tabular font-semibold">{peso(toNumber(f.allocations))}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-ink-muted">Used</dt>
                <dd className="tabular font-semibold">{peso(used)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-ink-muted">Remaining</dt>
                <dd className={cn('tabular font-semibold', toNumber(f.closing_balance) < 0 ? 'text-danger-600' : 'text-brand-700')}>{peso(f.closing_balance)}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                <span>Utilization</span>
                <span className="tabular">{util.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={util} aria-valuemin={0} aria-valuemax={100} aria-label={`${f.name} utilization`}>
                <div className={cn('h-2 rounded-full', util > 90 ? 'bg-warn-500' : 'bg-brand-500')} style={{ width: `${util}%` }} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-surface-border pt-3 text-xs text-ink-muted">
              <span>
                Opening {peso(f.opening_balance)} · funds in {peso(allocated)}
              </span>
              {canManage && (
                <button onClick={() => onSpend(f.fund_category_id)} className="font-medium text-brand-600 hover:underline">
                  Record use
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- allocation
function AllocationRuns({ period }: { period: Period }) {
  const { can } = useAuth();
  const { data: runs = [], isLoading } = useAllocationRuns();
  const [start, setStart] = useState(period.start);
  const [end, setEnd] = useState(period.end > todayPH() ? todayPH() : period.end);
  const [remarks, setRemarks] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reverse, setReverse] = useState<string | null>(null);
  useEffect(() => {
    setStart(period.start);
    setEnd(period.end > todayPH() ? todayPH() : period.end);
  }, [period]);
  const preview = useQuery({
    queryKey: [...keys.funds, 'preview', start, end],
    enabled: Boolean(start && end && end >= start),
    queryFn: () => rpc<AllocationPreview>('preview_fund_allocation', { p_start: start, p_end: end }),
  });
  const p = preview.data;
  const run = useAction(() => rpc('run_fund_allocation', { p_start: start, p_end: end, p_remarks: remarks }), {
    success: 'Allocation posted to the funds.',
    onSuccess: () => {
      setConfirm(false);
      setRemarks('');
    },
  });
  const rev = useAction((reason: string) => rpc('reverse_fund_allocation', { p_run_id: reverse, p_reason: reason }), { success: 'Allocation run reversed.', onSuccess: () => setReverse(null) });
  const overlapping = (p?.overlapping_runs?.length ?? 0) > 0;
  const base = toNumber(p?.base_amount);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader title="Allocate a period" description="Preview the calculation before posting it to the funds" icon={<Calculator />} />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={end} min={start} max={todayPH()} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          {preview.isLoading ? (
            <Skeleton className="h-48" />
          ) : p?.error ? (
            <Callout tone="warning">{p.error}</Callout>
          ) : p?.rule ? (
            <>
              <div className="rounded-xl border border-surface-border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5 text-sm">
                  <span className="font-medium">{p.rule.name}</span>
                  {p.rule.confirmed ? <Badge tone="green">Confirmed</Badge> : <Badge tone="gold">Awaiting confirmation</Badge>}
                </div>
                <div className="space-y-1.5 px-4 py-3 text-sm">
                  <div className="flex justify-between text-ink-muted">
                    <span>Basis</span>
                    <span className="text-right text-ink">{BASIS_LABEL[p.rule.basis]}</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Gross sales</span>
                    <span className="tabular text-ink">{peso(p.totals.gross_sales)}</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Net sales</span>
                    <span className="tabular text-ink">{peso(p.totals.net_sales)}</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Cash carry-overs</span>
                    <span className="tabular text-ink">{peso(p.totals.carryover)}</span>
                  </div>
                  <div className="flex justify-between border-t border-surface-border pt-2 font-semibold">
                    <span>Allocation base</span>
                    <span className="tabular">{peso(base)}</span>
                  </div>
                </div>
                <Table>
                  <THead>
                    <tr>
                      <TH>Fund</TH>
                      <TH align="right">%</TH>
                      <TH align="right">Amount</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {p.lines?.map((l) => (
                      <TR key={l.fund_category_id}>
                        <TD>{l.name}</TD>
                        <TD align="right">{toNumber(l.percentage)}%</TD>
                        <TD align="right" className="font-medium">{peso(l.amount)}</TD>
                      </TR>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-page font-semibold">
                      <TD>Total allocated</TD>
                      <TD align="right">{toNumber(p.total_percentage)}%</TD>
                      <TD align="right">{peso(p.allocated_total)}</TD>
                    </tr>
                    {toNumber(p.unallocated) !== 0 && (
                      <tr className="text-ink-muted">
                        <TD colSpan={2}>Unallocated (rounding / percentages below 100%)</TD>
                        <TD align="right">{peso(p.unallocated)}</TD>
                      </tr>
                    )}
                  </tfoot>
                </Table>
              </div>
              {overlapping && <Callout tone="danger">Part of this period is already allocated (run #{p.overlapping_runs![0].run_no}). Reverse that run first.</Callout>}
              {base <= 0 && <Callout tone="warning">The allocation base is {peso(base)} — nothing to allocate for this period.</Callout>}
              {can('funds.manage') && (
                <>
                  <Field label="Remarks">
                    <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
                  </Field>
                  <Button className="w-full" disabled={overlapping || base <= 0} onClick={() => setConfirm(true)}>
                    Post allocation
                  </Button>
                </>
              )}
            </>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Allocation history" description="Each run keeps the rule, base and amounts used at the time — later rule changes never alter it." />
        {isLoading ? (
          <TableSkeleton />
        ) : runs.length === 0 ? (
          <EmptyState icon={<Calculator />} title="No allocations posted yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Run</TH>
                <TH>Period</TH>
                <TH>Basis</TH>
                <TH align="right">Base</TH>
                <TH align="right">Allocated</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">FA-{r.run_no}</TD>
                  <TD className="whitespace-nowrap">{formatDate(r.period_start, 'short')} – {formatDate(r.period_end)}</TD>
                  <TD className="text-xs text-ink-muted">{BASIS_LABEL[r.basis]}</TD>
                  <TD align="right">{peso(r.base_amount)}</TD>
                  <TD align="right" className="font-semibold">{peso(r.allocated_total)}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                    {r.reversal_reason && <div className="mt-1 max-w-[180px] text-xs text-ink-muted">{r.reversal_reason}</div>}
                  </TD>
                  <TD align="right">
                    {r.status === 'posted' && can('funds.manage') && (
                      <Button variant="danger-ghost" size="sm" onClick={() => setReverse(r.id)}>
                        <Undo2 /> Reverse
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Post this allocation?"
        description={`${peso(p?.allocated_total)} will be credited to the funds for ${describePeriod(start, end)}. The period cannot be allocated again unless this run is reversed.`}
        confirmLabel="Post allocation"
        loading={run.isPending}
        onConfirm={() => run.mutate(undefined)}
      />
      <ReasonDialog open={Boolean(reverse)} onOpenChange={(o) => !o && setReverse(null)} title="Reverse allocation run?" description="All fund credits from this run are reversed. Not possible if a fund has already spent the money." confirmLabel="Reverse run" loading={rev.isPending} onConfirm={(r) => rev.mutate(r)} />
    </div>
  );
}

// ----------------------------------------------------------- fund ledger
function FundLedger({ period, funds }: { period: Period; funds: FundSummaryRow[] }) {
  const { can } = useAuth();
  const { activeSchoolYear } = useApp();
  const [fundId, setFundId] = useState('');
  useEffect(() => {
    if (!fundId && funds[0]) setFundId(funds[0].fund_category_id);
  }, [funds, fundId]);
  const fund = funds.find((f) => f.fund_category_id === fundId);
  const { data: txns = [], isLoading } = useFundTxns(fundId || undefined, period.start, period.end);
  const [reverse, setReverse] = useState<string | null>(null);
  const rev = useAction((reason: string) => rpc('reverse_fund_transaction', { p_id: reverse, p_reason: reason }), { success: 'Entry reversed.', onSuccess: () => setReverse(null) });
  const label = { opening: 'Opening balance', allocation: 'Allocation', expenditure: 'Authorized expenditure', adjustment: 'Adjustment', reversal: 'Reversal', allocation_reversal: 'Allocation reversal' } as const;

  const report = (): OfficialReport => ({
    title: `Fund Report — ${fund?.name ?? ''}`,
    period: describePeriod(period.start, period.end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Fund-${fund?.code}-${period.start}_${period.end}`,
    columns: [
      { key: 'transaction_date', header: 'Date', format: 'date', width: 14 },
      { key: 'type', header: 'Type', width: 18 },
      { key: 'description', header: 'Description', width: 30 },
      { key: 'reference_no', header: 'Reference', width: 14 },
      { key: 'amount', header: 'Amount', format: 'peso', width: 14 },
      { key: 'status', header: 'Status', width: 10 },
    ],
    rows: [...txns].reverse().map((t) => ({ ...t, type: label[t.transaction_type] })),
    summary: fund
      ? [
          { label: 'Opening balance', value: peso(fund.opening_balance) },
          { label: 'New allocations', value: peso(fund.allocations) },
          { label: 'Authorized expenditures', value: peso(fund.expenditures) },
          { label: 'Adjustments', value: peso(fund.adjustments) },
          { label: 'Closing balance', value: peso(fund.closing_balance), emphasis: true },
        ]
      : [],
  });

  return (
    <>
      <Card className="no-print">
        <CardHeader
          title="Fund transaction history"
          actions={
            <>
              <Select value={fundId} onChange={(e) => setFundId(e.target.value)} className="w-72">
                {funds.map((f) => (
                  <option key={f.fund_category_id} value={f.fund_category_id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <ExportMenu report={report} disabled={!fund} />
            </>
          }
        />
        {fund && (
          <div className="grid grid-cols-2 gap-px border-b border-surface-border bg-surface-border sm:grid-cols-5">
            {[
              ['Opening balance', fund.opening_balance],
              ['New allocations', fund.allocations],
              ['Expenditures', -toNumber(fund.expenditures)],
              ['Adjustments', fund.adjustments],
              ['Closing balance', fund.closing_balance],
            ].map(([l, v]) => (
              <div key={l as string} className="bg-white px-5 py-3">
                <div className="text-xs text-ink-muted">{l}</div>
                <div className={cn('tabular mt-0.5 font-semibold', toNumber(v) < 0 && 'text-danger-600')}>{peso(v)}</div>
              </div>
            ))}
          </div>
        )}
        {isLoading ? (
          <TableSkeleton />
        ) : txns.length === 0 ? (
          <EmptyState icon={<History />} title="No fund transactions in this period" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>#</TH>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Description</TH>
                <TH>Reference</TH>
                <TH align="right">Amount</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {txns.map((t) => (
                <TR key={t.id} className={t.status === 'reversed' ? 'opacity-60' : ''}>
                  <TD className="font-mono text-xs text-ink-muted">FD-{t.txn_no}</TD>
                  <TD>{formatDate(t.transaction_date)}</TD>
                  <TD>
                    {label[t.transaction_type]}
                    {t.percentage_applied !== null && <span className="ml-1 text-xs text-ink-muted">({toNumber(t.percentage_applied)}%)</span>}
                  </TD>
                  <TD className="max-w-[300px]">
                    {t.description}
                    {t.reversal_reason && <div className="text-xs text-ink-muted">Reversed: {t.reversal_reason}</div>}
                  </TD>
                  <TD className="text-ink-muted">{t.reference_no ?? '—'}</TD>
                  <TD align="right" className={cn('font-semibold', toNumber(t.amount) < 0 ? 'text-danger-600' : 'text-brand-700')}>{peso(t.amount)}</TD>
                  <TD><StatusBadge status={t.status} /></TD>
                  <TD align="right">
                    {t.status === 'posted' && !t.allocation_run_id && can('funds.manage') && (
                      <Button variant="danger-ghost" size="sm" onClick={() => setReverse(t.id)}>
                        <Undo2 /> Reverse
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <PrintableReport report={fund ? report() : null} />
      <ReasonDialog open={Boolean(reverse)} onOpenChange={(o) => !o && setReverse(null)} title="Reverse fund entry?" description="The entry stays on record as reversed and no longer affects the balance." confirmLabel="Reverse" loading={rev.isPending} onConfirm={(r) => rev.mutate(r)} />
    </>
  );
}

function FundTxnDialog({ open, onOpenChange, fundId }: { open: boolean; onOpenChange: (o: boolean) => void; fundId?: string }) {
  const { data: funds = [] } = useFundCategories();
  const { workingDate } = useApp();
  const [f, setF] = useState({ fund_category_id: '', transaction_type: 'expenditure', amount: '', direction: '1', transaction_date: workingDate, description: '', reference_no: '', remarks: '' });
  const [key, setKey] = useState(uuid());
  useEffect(() => {
    if (open) {
      setF({ fund_category_id: fundId ?? funds[0]?.id ?? '', transaction_type: 'expenditure', amount: '', direction: '1', transaction_date: workingDate, description: '', reference_no: '', remarks: '' });
      setKey(uuid());
    }
  }, [open, fundId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    () =>
      rpc('record_fund_transaction', {
        p: { ...f, amount: f.transaction_type === 'adjustment' ? Number(f.amount) * Number(f.direction) : Number(f.amount), idempotency_key: key },
      }),
    { success: 'Fund entry recorded.', onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record fund entry"
      description="Expenditures cannot exceed the fund's available balance."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={save.isPending} disabled={!f.fund_category_id || !(Number(f.amount) > 0) || (f.transaction_type !== 'opening' && !f.description.trim())} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fund" required className="sm:col-span-2">
          <Select value={f.fund_category_id} onChange={(e) => setF({ ...f, fund_category_id: e.target.value })}>
            {funds.filter((x) => x.is_active).map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Entry type" required>
          <Select value={f.transaction_type} onChange={(e) => setF({ ...f, transaction_type: e.target.value })}>
            <option value="expenditure">Authorized expenditure</option>
            <option value="adjustment">Adjustment</option>
            <option value="opening">Opening balance</option>
          </Select>
        </Field>
        {f.transaction_type === 'adjustment' && (
          <Field label="Direction">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="1">Increase balance</option>
              <option value="-1">Decrease balance</option>
            </Select>
          </Field>
        )}
        <Field label="Amount" required>
          <Input type="number" min={0} step="0.01" prefix="₱" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Date" required>
          <Input type="date" max={todayPH()} value={f.transaction_date} onChange={(e) => setF({ ...f, transaction_date: e.target.value })} />
        </Field>
        <Field label="Reference no.">
          <Input value={f.reference_no} onChange={(e) => setF({ ...f, reference_no: e.target.value })} />
        </Field>
        <Field label="Description" required={f.transaction_type !== 'opening'} className="sm:col-span-2">
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Feeding program ingredients, OR #1234" />
        </Field>
        <Field label="Remarks" className="sm:col-span-2">
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ rules
function RulesTab() {
  const { can } = useAuth();
  const { data: rules = [], isLoading } = useAllocationRules();
  const { data: funds = [] } = useFundCategories();
  const [edit, setEdit] = useState<AllocationRule | 'new' | null>(null);
  const [activate, setActivate] = useState<AllocationRule | null>(null);
  const act = useAction((id: string) => rpc('activate_allocation_rule', { p_id: id }), { success: 'Rule activated.', onSuccess: () => setActivate(null) });
  const confirm = useAction((id: string) => rpc('confirm_allocation_rule', { p_id: id }), { success: 'Rule confirmed.' });
  const del = useAction((id: string) => rpc('delete_allocation_rule_draft', { p_id: id }), { success: 'Draft deleted.' });
  const fundName = (id: string) => funds.find((f) => f.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <Callout tone="info" title="How allocation rules work">
        Percentages are stored per rule with an effective date. Activated rules are frozen; to change percentages, create a new rule with a later effective date. Past allocation runs keep the amounts they were posted with.
      </Callout>
      <div className="flex justify-end">
        {can('funds.manage') && (
          <Button onClick={() => setEdit('new')}>
            <Plus /> New rule
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-60" />
      ) : (
        rules.map((r) => {
          const total = (r.allocation_rule_lines ?? []).reduce((a, l) => a + toNumber(l.percentage), 0);
          return (
            <Card key={r.id}>
              <CardHeader
                title={r.name}
                description={`Effective ${formatDate(r.effective_from, 'long')} · Basis: ${BASIS_LABEL[r.basis]}`}
                actions={
                  <>
                    <StatusBadge status={r.status} />
                    {r.status === 'active' && (r.confirmed_at ? <Badge tone="green"><BadgeCheck className="size-3" /> Confirmed</Badge> : <Badge tone="gold">Awaiting confirmation</Badge>)}
                    {r.status === 'active' && !r.confirmed_at && can('settings.manage') && (
                      <Button size="sm" variant="secondary" loading={confirm.isPending} onClick={() => confirm.mutate(r.id)}>
                        Confirm rule
                      </Button>
                    )}
                    {r.status === 'draft' && can('funds.manage') && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
                        <Button size="sm" variant="danger-ghost" onClick={() => del.mutate(r.id)}><Trash2 /></Button>
                        <Button size="sm" onClick={() => setActivate(r)}>Activate</Button>
                      </>
                    )}
                  </>
                }
              />
              <CardBody>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(r.allocation_rule_lines ?? []).map((l) => (
                    <div key={l.fund_category_id} className="flex items-center justify-between rounded-lg bg-surface-page px-3 py-2 text-sm">
                      <span>{fundName(l.fund_category_id)}</span>
                      <span className="tabular font-semibold">{toNumber(l.percentage)}%</span>
                    </div>
                  ))}
                </div>
                <div className={cn('mt-3 text-sm font-medium', total === 100 ? 'text-brand-700' : 'text-warn-700')}>Total: {total}%</div>
                {r.notes && <p className="mt-2 text-xs text-ink-muted">{r.notes}</p>}
              </CardBody>
            </Card>
          );
        })
      )}
      {rules.length === 0 && !isLoading && (
        <div className="card">
          <EmptyState icon={<Scale />} title="No allocation rules" />
        </div>
      )}
      <RuleDialog rule={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog
        open={Boolean(activate)}
        onOpenChange={(o) => !o && setActivate(null)}
        title={`Activate “${activate?.name}”?`}
        description="The percentages will be locked and used for allocation periods starting on or after the effective date. This change is recorded in the audit log."
        confirmLabel="Activate rule"
        loading={act.isPending}
        onConfirm={() => activate && act.mutate(activate.id)}
      />
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: AllocationRule | 'new' | null; onClose: () => void }) {
  const { data: funds = [] } = useFundCategories();
  const [f, setF] = useState({ name: '', effective_from: todayPH(), basis: 'net_sales' as AllocationBasis, notes: '' });
  const [pct, setPct] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!rule) return;
    if (rule === 'new') {
      setF({ name: '', effective_from: todayPH(), basis: 'net_sales', notes: '' });
      setPct({});
    } else {
      setF({ name: rule.name, effective_from: rule.effective_from, basis: rule.basis, notes: rule.notes ?? '' });
      setPct(Object.fromEntries((rule.allocation_rule_lines ?? []).map((l) => [l.fund_category_id, String(toNumber(l.percentage))])));
    }
  }, [rule]);
  const total = useMemo(() => Object.values(pct).reduce((a, v) => a + (Number(v) || 0), 0), [pct]);
  const save = useAction(
    () =>
      rpc('save_allocation_rule', {
        p_id: rule === 'new' ? null : rule!.id,
        p: { ...f, lines: Object.entries(pct).filter(([, v]) => v !== '').map(([fund_category_id, percentage]) => ({ fund_category_id, percentage: Number(percentage) })) },
      }),
    { success: 'Draft rule saved. Activate it when ready.', onSuccess: onClose },
  );
  return (
    <Dialog
      open={Boolean(rule)}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={rule === 'new' ? 'New allocation rule (draft)' : 'Edit draft rule'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!f.effective_from || total > 100} onClick={() => save.mutate(undefined)}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rule name" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. SY 2026-2027 allocation" />
        </Field>
        <Field label="Effective from" required>
          <Input type="date" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} />
        </Field>
        <Field label="Allocation basis" required hint="Which revenue figure is distributed to the funds.">
          <Select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as AllocationBasis })}>
            {Object.entries(BASIS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2 space-y-2">
          <div className="text-[13px] font-medium">Percentages</div>
          {funds.filter((x) => x.is_active).map((x) => (
            <div key={x.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm">
                {x.name}
                {!x.is_allocatable && <span className="ml-2 text-xs text-ink-muted">(not allocatable)</span>}
              </span>
              <div className="relative w-28">
                <Input type="number" min={0} max={100} step="0.001" disabled={!x.is_allocatable} value={pct[x.id] ?? ''} onChange={(e) => setPct({ ...pct, [x.id]: e.target.value })} className="pr-7 text-right" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">%</span>
              </div>
            </div>
          ))}
          <div className={cn('flex justify-between border-t border-surface-border pt-2 text-sm font-semibold', total > 100 ? 'text-danger-600' : total === 100 ? 'text-brand-700' : 'text-warn-700')}>
            <span>Total</span>
            <span>{total}%</span>
          </div>
        </div>
        <Field label="Notes / approval reference" className="sm:col-span-2">
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <FileText className="size-3.5" /> If school policy requires full allocation, activation fails unless the total is exactly 100%.
      </p>
    </Dialog>
  );
}
