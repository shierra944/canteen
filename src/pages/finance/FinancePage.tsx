import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PhilippinePeso, MinusCircle, MoreHorizontal, Pencil, PiggyBank, Plus, Receipt, Search, Undo2, Wallet } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { useQuery } from '@tanstack/react-query';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { useAction, useCarryovers, useCashAsOf, useFinCategories, useFinancialTxns, useMonthlySummary } from '@/lib/queries';
import { addDays, cashPeriodDates, describePeriod, firstSchoolDayOnOrAfter, monthKey, monthRange, resolvePeriod, type Period } from '@/lib/periods';
import { formatDate, formatDateTime, parseISODate, peso, toNumber, todayPH } from '@/lib/utils';
import { FIN_TYPE_LABEL, personLabel } from '@/lib/labels';
import type { FinancialTxn } from '@/lib/types';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, StatusBadge, TypeBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterBar, FilterField, KeyValue, PeriodPicker, ReasonDialog, StatCard } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import { AuditTrail } from '@/components/AuditTrail';
import type { OfficialReport } from '@/lib/export/report';
import { TxnDialog } from './TxnDialog';

const PAGE = 25;

export default function FinancePage() {
  const { can } = useAuth();
  const { workingDate, activeSchoolYear } = useApp();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('this_month', workingDate));
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState('posted');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'list' | 'daily' | 'monthly'>('list');
  const tableRef = useRef<HTMLDivElement>(null);
  // clicking a summary card filters the table to the entries behind it;
  // clicking the selected card again clears that filter
  const showType = (t: 'sale' | 'expense' | 'deficit') => {
    if (type === t) {
      setType('');
      setPage(1);
      return;
    }
    setType(t);
    setCategoryId('');
    setStatus('posted');
    setView('list');
    setPage(1);
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const { data: cats = [] } = useFinCategories();
  const { data: rows = [], isLoading, error, refetch } = useFinancialTxns({
    start: period.start,
    end: period.end,
    type: type || undefined,
    categoryId: categoryId || undefined,
    requestedBy: person || undefined,
    status: status || undefined,
    search: search.trim() || undefined,
  });
  const [dialog, setDialog] = useState<{ open: boolean; txn: FinancialTxn | null }>({ open: false, txn: null });
  const [reverse, setReverse] = useState<FinancialTxn | null>(null);
  const [detail, setDetail] = useState<FinancialTxn | null>(null);

  // deep link: /finance?txn=<id>
  const txnParam = params.get('txn');
  const { data: linked } = useQuery({
    queryKey: ['finance', 'one', txnParam],
    enabled: Boolean(txnParam),
    queryFn: async () => unwrap(await supabase.from('v_financial_transactions').select('*').eq('id', txnParam!).maybeSingle()) as FinancialTxn | null,
  });
  useEffect(() => {
    if (linked) setDetail(linked);
  }, [linked]);

  const reverseTxn = useAction((reason: string) => rpc('reverse_financial_transaction', { p_id: reverse!.id, p_reason: reason }), {
    success: 'Transaction reversed. It no longer counts in totals.',
    onSuccess: () => setReverse(null),
  });

  // Card totals ignore the type/category filter the cards themselves set,
  // so selecting one card never zeroes the others.
  const { data: cardRows = [] } = useFinancialTxns({
    start: period.start,
    end: period.end,
    requestedBy: person || undefined,
    status: 'posted',
    search: search.trim() || undefined,
  });

  const posted = rows.filter((r) => r.status === 'posted');
  const totalsOf = (src: FinancialTxn[]) => {
    const sum = (t: string, pred: (r: FinancialTxn) => boolean = () => true) =>
      src.filter((r) => r.transaction_type === t && pred(r)).reduce((a, r) => a + toNumber(r.amount), 0);
    return {
      sales: sum('sale', (r) => !r.included_in_daily_sales),
      included: sum('sale', (r) => r.included_in_daily_sales),
      expenses: sum('expense'),
      deficit: sum('deficit'),
    };
  };
  const totals = totalsOf(cardRows);
  // the table and exports total only the rows they show
  const listTotals = totalsOf(posted);

  const grouped = useMemo(() => {
    const keyOf = (d: string) => (view === 'monthly' ? d.slice(0, 7) : d);
    const m = new Map<string, { key: string; sales: number; expenses: number; deficit: number; count: number }>();
    posted.forEach((r) => {
      const k = keyOf(r.transaction_date);
      const g = m.get(k) ?? { key: k, sales: 0, expenses: 0, deficit: 0, count: 0 };
      if (r.transaction_type === 'sale' && !r.included_in_daily_sales) g.sales += toNumber(r.amount);
      if (r.transaction_type === 'expense') g.expenses += toNumber(r.amount);
      if (r.transaction_type === 'deficit') g.deficit += toNumber(r.amount);
      g.count++;
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [posted, view]);

  const active = Boolean(type || categoryId || person || status !== 'posted' || search);
  const report = (): OfficialReport => ({
    title: 'Canteen Daily Expenses & Other Sales',
    period: describePeriod(period.start, period.end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Expenses-Other-Sales-${period.start}_${period.end}`,
    columns: [
      { key: 'no', header: 'No.', width: 6 },
      { key: 'transaction_date', header: 'Date', format: 'date', width: 14 },
      { key: 'description', header: 'Item', width: 28 },
      { key: 'type', header: 'Nature of Item', width: 12 },
      { key: 'category_name', header: 'Category', width: 18 },
      { key: 'requested_by', header: personLabel(type), width: 20 },
      { key: 'amount', header: 'Amount', format: 'peso', width: 14 },
      { key: 'status_label', header: 'Status', width: 10 },
    ],
    rows: rows.map((r, i) => ({
      ...r,
      no: i + 1,
      type: FIN_TYPE_LABEL[r.transaction_type] + (r.included_in_daily_sales ? ' (in daily sales)' : ''),
      status_label: r.status === 'posted' ? 'Posted' : 'Reversed',
    })),
    summary: [
      { label: 'Sale (Other Shares)', value: peso(listTotals.sales) },
      { label: 'Expense', value: peso(listTotals.expenses) },
      { label: 'Deficit', value: peso(listTotals.deficit) },
      ...(listTotals.included ? [{ label: 'Sales already in daily sales (excluded)', value: peso(listTotals.included) }] : []),
    ],
    notes: ['Totals include posted transactions only. Reversed entries are listed for transparency and excluded from totals.'],
  });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Expenses & Other Sales"
          description="Daily transactions not covered by the Daily Sales sheet: other sales (shares), expenses and deficits."
          actions={
            <>
              <ExportMenu report={report} disabled={rows.length === 0} />
              {can('finance.record') && (
                <Button onClick={() => setDialog({ open: true, txn: null })}>
                  <Plus /> Record transaction
                </Button>
              )}
            </>
          }
        />
        <Tabs defaultValue="transactions">
          <TabsList className="mb-5">
            <TabsTrigger value="transactions" icon={<Receipt />}>
              Transactions
            </TabsTrigger>
            <TabsTrigger value="carryovers" icon={<PiggyBank />}>
              Cash carry-overs
            </TabsTrigger>
          </TabsList>
          <TabsContent value="transactions" className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />
              <span className="text-xs text-ink-muted">{describePeriod(period.start, period.end)}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Other sales (shares)" value={peso(totals.sales)} icon={<PhilippinePeso />} tone="positive" sub={totals.included ? `${peso(totals.included)} already in daily sales — excluded` : 'Added to Gross Sales'} onClick={() => showType('sale')} active={type === 'sale'} />
              <StatCard label="Expenses" value={peso(totals.expenses)} icon={<Wallet />} sub="Deducted in Net Sales" onClick={() => showType('expense')} active={type === 'expense'} />
              <StatCard label="Deficit" value={peso(totals.deficit)} icon={<MinusCircle />} tone={totals.deficit ? 'negative' : 'default'} sub="Recorded separately from expenses" onClick={() => showType('deficit')} active={type === 'deficit'} />
            </div>
            <div ref={tableRef} className="scroll-mt-20" />
            <Card>
              <FilterBar
                active={active}
                onClear={() => {
                  setType('');
                  setCategoryId('');
                  setPerson('');
                  setStatus('posted');
                  setSearch('');
                }}
              >
                <FilterField label="Search" className="min-w-[200px] flex-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                    <Input className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Item or person" />
                  </div>
                </FilterField>
                <FilterField label="Type">
                  <Select value={type} onChange={(e) => { setType(e.target.value); setCategoryId(''); setPage(1); }}>
                    <option value="">All types</option>
                    <option value="sale">Sale</option>
                    <option value="expense">Expense</option>
                    <option value="deficit">Deficit</option>
                  </Select>
                </FilterField>
                <FilterField label="Category">
                  <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
                    <option value="">All categories</option>
                    {cats.filter((c) => !type || c.transaction_type === type).map((c) => (
                      <option key={c.id} value={c.id}>
                        {FIN_TYPE_LABEL[c.transaction_type]} · {c.name}
                      </option>
                    ))}
                  </Select>
                </FilterField>
                <FilterField label="Person responsible">
                  <Input value={person} onChange={(e) => { setPerson(e.target.value); setPage(1); }} placeholder={personLabel(type)} />
                </FilterField>
                <FilterField label="Status">
                  <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                    <option value="posted">Posted</option>
                    <option value="reversed">Reversed</option>
                    <option value="">All</option>
                  </Select>
                </FilterField>
              </FilterBar>
              <div className="flex items-center gap-1 border-b border-surface-border px-5 py-2">
                {(['list', 'daily', 'monthly'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${view === v ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:text-ink'}`}>
                    {v === 'list' ? 'All entries' : v === 'daily' ? 'Daily totals' : 'Monthly totals'}
                  </button>
                ))}
              </div>
              {error ? (
                <ErrorState error={error} onRetry={() => refetch()} />
              ) : isLoading ? (
                <TableSkeleton />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={<Receipt />}
                  title="No transactions in this period"
                  description="Record expenses, other sales and deficits as they happen."
                  action={can('finance.record') && (
                    <Button onClick={() => setDialog({ open: true, txn: null })}>
                      <Plus /> Record transaction
                    </Button>
                  )}
                />
              ) : view !== 'list' ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>{view === 'daily' ? 'Date' : 'Month'}</TH>
                      <TH align="right">Entries</TH>
                      <TH align="right">Sales (other shares)</TH>
                      <TH align="right">Expenses</TH>
                      <TH align="right">Deficit</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {grouped.map((g) => (
                      <TR key={g.key}>
                        <TD className="font-medium">{view === 'daily' ? formatDate(g.key, 'long') : new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(new Date(g.key + '-01T00:00'))}</TD>
                        <TD align="right">{g.count}</TD>
                        <TD align="right" className="text-brand-700">{peso(g.sales)}</TD>
                        <TD align="right">{peso(g.expenses)}</TD>
                        <TD align="right" className={g.deficit ? 'text-danger-600' : ''}>{peso(g.deficit)}</TD>
                      </TR>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-page font-semibold">
                      <TD>Total</TD>
                      <TD align="right">{posted.length}</TD>
                      <TD align="right">{peso(listTotals.sales)}</TD>
                      <TD align="right">{peso(listTotals.expenses)}</TD>
                      <TD align="right">{peso(listTotals.deficit)}</TD>
                    </tr>
                  </tfoot>
                </Table>
              ) : (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <TH>No.</TH>
                        <TH>Date</TH>
                        <TH>Item / description</TH>
                        <TH>Nature</TH>
                        <TH>Category</TH>
                        <TH>{personLabel(type)}</TH>
                        <TH align="right">Amount</TH>
                        <TH>Recorded by</TH>
                        <TH>Status</TH>
                        <TH />
                      </tr>
                    </THead>
                    <tbody>
                      {rows.slice((page - 1) * PAGE, page * PAGE).map((r) => (
                        <TR key={r.id} onClick={() => setDetail(r)} className={r.status === 'reversed' ? 'opacity-60' : ''}>
                          <TD className="font-mono text-xs text-ink-muted">FT-{r.txn_no}</TD>
                          <TD className="whitespace-nowrap">{formatDate(r.transaction_date)}</TD>
                          <TD className="max-w-[280px]">
                            <div className={`font-medium ${r.status === 'reversed' ? 'line-through' : ''}`}>{r.description}</div>
                            {r.included_in_daily_sales && <div className="text-xs text-ink-muted">Already in daily sales — not added to totals</div>}
                            {r.source_type !== 'manual' && <div className="text-xs text-ink-muted">Source: {r.source_type === 'stock_receipt' ? 'stock receipt' : 'Excel import'}</div>}
                          </TD>
                          <TD><TypeBadge type={r.transaction_type} /></TD>
                          <TD className="text-ink-muted">{r.category_name ?? '—'}</TD>
                          <TD className="text-ink-muted">{r.requested_by ?? '—'}</TD>
                          <TD align="right" className="font-semibold">{peso(r.amount)}</TD>
                          <TD className="whitespace-nowrap text-ink-muted">{r.created_by_name ?? '—'}</TD>
                          <TD><StatusBadge status={r.status} /></TD>
                          <TD align="right" onClick={(e) => e.stopPropagation()}>
                            {r.status === 'posted' && (can('finance.record') || can('finance.correct')) && (
                              <Menu>
                                <MenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label="Actions">
                                    <MoreHorizontal />
                                  </Button>
                                </MenuTrigger>
                                <MenuContent>
                                  <MenuItem icon={<Pencil />} disabled={r.source_type === 'stock_receipt'} onSelect={() => setDialog({ open: true, txn: r })}>
                                    Edit / correct
                                  </MenuItem>
                                  <MenuItem icon={<Undo2 />} danger onSelect={() => setReverse(r)}>
                                    Reverse
                                  </MenuItem>
                                </MenuContent>
                              </Menu>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
                </>
              )}
            </Card>
          </TabsContent>
          <TabsContent value="carryovers">
            <Carryovers />
          </TabsContent>
        </Tabs>
      </div>

      <PrintableReport report={rows.length ? report() : null} />

      <TxnDialog open={dialog.open} txn={dialog.txn} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} />
      <ReasonDialog
        open={Boolean(reverse)}
        onOpenChange={(o) => !o && setReverse(null)}
        title={`Reverse FT-${reverse?.txn_no}?`}
        description={`${reverse?.description} — ${peso(reverse?.amount)}. The entry stays on record as “Reversed” and is excluded from every total.`}
        confirmLabel="Reverse transaction"
        loading={reverseTxn.isPending}
        onConfirm={(r) => reverseTxn.mutate(r)}
      />
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(o) => {
          if (!o) {
            setDetail(null);
            if (txnParam) {
              params.delete('txn');
              setParams(params, { replace: true });
            }
          }
        }}
        title={detail ? `FT-${detail.txn_no} · ${detail.description}` : ''}
        size="lg"
      >
        {detail && (
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <KeyValue label="Date">{formatDate(detail.transaction_date, 'long')}</KeyValue>
              <KeyValue label="Type"><TypeBadge type={detail.transaction_type} /></KeyValue>
              <KeyValue label="Amount">{peso(detail.amount)}</KeyValue>
              <KeyValue label="Category">{detail.category_name ?? '—'}</KeyValue>
              <KeyValue label={personLabel(detail.transaction_type)}>{detail.requested_by ?? '—'}</KeyValue>
              <KeyValue label="Status"><StatusBadge status={detail.status} /></KeyValue>
              <KeyValue label="Counted in Other Shares">{detail.transaction_type === 'sale' ? (detail.included_in_daily_sales || detail.status !== 'posted' ? 'No' : 'Yes') : 'n/a'}</KeyValue>
              <KeyValue label="Created">{formatDateTime(detail.created_at)} · {detail.created_by_name ?? '—'}</KeyValue>
              <KeyValue label="Last updated">{formatDateTime(detail.updated_at)} · {detail.updated_by_name ?? '—'}</KeyValue>
              <KeyValue label="Source">{detail.source_type}</KeyValue>
              {detail.remarks && <KeyValue label="Remarks" className="col-span-full">{detail.remarks}</KeyValue>}
              {detail.reversal_reason && <KeyValue label="Reversal reason" className="col-span-full">{detail.reversal_reason}</KeyValue>}
            </dl>
            <div>
              <div className="mb-3 text-sm font-semibold">Audit history</div>
              <AuditTrail entityType="financial_transactions" entityId={detail.id} />
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function Carryovers() {
  const { can } = useAuth();
  const { workingDate } = useApp();
  const { data = [], isLoading } = useCarryovers();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ entry_date: workingDate, description: '', amount: '', remarks: '' });
  const [reverse, setReverse] = useState<string | null>(null);
  const add = useAction(() => rpc('create_cash_carryover', { p: { ...f, amount: Number(f.amount) } }), {
    success: 'Carry-over recorded.',
    onSuccess: () => {
      setOpen(false);
      setF({ entry_date: workingDate, description: '', amount: '', remarks: '' });
    },
  });
  const rev = useAction((reason: string) => rpc('reverse_cash_carryover', { p_id: reverse, p_reason: reason }), { success: 'Carry-over reversed.', onSuccess: () => setReverse(null) });
  const total = data.filter((c) => c.status === 'posted').reduce((a, c) => a + toNumber(c.amount), 0);
  return (
    <div className="space-y-6">
    <MonthEndCash />
    <Card>
      <CardHeader
        title="Opening balance (manual carry-overs)"
        description="Only for cash the canteen already had before its records in this app begin (e.g. September's leftover cash). Month-end carry-overs are automatic (above) — do not add them here, or the money is counted twice."
        actions={can('finance.correct') && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Add carry-over
          </Button>
        )}
      />
      {isLoading ? (
        <TableSkeleton />
      ) : data.length === 0 ? (
        <EmptyState icon={<PiggyBank />} title="No carry-overs recorded" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH align="right">Amount</TH>
              <TH>Status</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {data.map((c) => (
              <TR key={c.id}>
                <TD>{formatDate(c.entry_date)}</TD>
                <TD>
                  {c.description}
                  {c.reversal_reason && <div className="text-xs text-ink-muted">{c.reversal_reason}</div>}
                </TD>
                <TD align="right" className="font-semibold">{peso(c.amount)}</TD>
                <TD><StatusBadge status={c.status} /></TD>
                <TD align="right">
                  {c.status === 'posted' && can('finance.correct') && (
                    <Button variant="danger-ghost" size="sm" onClick={() => setReverse(c.id)}>
                      <Undo2 /> Reverse
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-page font-semibold">
              <TD colSpan={2}>Total posted</TD>
              <TD align="right">{peso(total)}</TD>
              <TD colSpan={2} />
            </tr>
          </tfoot>
        </Table>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add cash carry-over"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={add.isPending} disabled={!f.description.trim() || !(Number(f.amount) > 0) || !f.entry_date} onClick={() => add.mutate(undefined)}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            <Input type="date" max={todayPH()} value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} />
          </Field>
          <Field label="Amount" required>
            <Input type="number" min={0} step="0.01" prefix="₱" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Description" required className="sm:col-span-2">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Cash on hand before using the app" />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          </Field>
        </div>
      </Dialog>
      <ReasonDialog open={Boolean(reverse)} onOpenChange={(o) => !o && setReverse(null)} title="Reverse carry-over?" description="It will no longer count in Remaining Money or allocation bases." confirmLabel="Reverse" loading={rev.isPending} onConfirm={(r) => rev.mutate(r)} />
      <CardBody className="border-t border-surface-border text-xs text-ink-muted">
        <Badge tone="gold">Note</Badge> Only users with the “finance.correct” permission can record or reverse carry-overs.
      </CardBody>
    </Card>
    </div>
  );
}

/**
 * Each month's closing cash (its last school day) carried over to the next
 * month's first school day — calculated from the records, never typed in.
 */
function MonthEndCash() {
  const { settings, activeSchoolYear } = useApp();
  const today = todayPH();
  const from = activeSchoolYear?.start_date ?? addDays(today, -365);
  const { data: months = [], isLoading } = useMonthlySummary(from, today);
  const { data: carry = [] } = useCarryovers();
  const monthStarts = [
    ...new Set([
      ...months.map((m) => m.month_start),
      // the month whose closing cash is the opening balance
      ...carry.filter((c) => c.status === 'posted' && c.entry_date >= from && c.entry_date <= today).map((c) => monthKey(c.entry_date)),
    ]),
  ].sort();
  const rows = monthStarts.map((ms) => {
    const d = parseISODate(ms);
    const end = monthRange(d.getFullYear(), d.getMonth()).end;
    return { ms, ...cashPeriodDates(ms, end, settings?.school_days, today), carriedTo: firstSchoolDayOnOrAfter(addDays(end, 1), settings?.school_days) };
  });
  const { data: cash } = useCashAsOf(rows.map((r) => r.closingAsOf), rows.length > 0);
  const monthName = (ms: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(parseISODate(ms));
  return (
    <Card>
      <CardHeader
        title="Month-end carry-overs (automatic)"
        description="Each month's closing cash on its last school day is carried over as the opening cash of the next month's first school day. Calculated from the records — nothing to enter."
        icon={<PiggyBank />}
      />
      {isLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={<PiggyBank />} title="No months recorded yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH>Closing date</TH>
              <TH align="right">Closing cash</TH>
              <TH>Carried over to</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.ms}>
                <TD className="font-medium">{monthName(r.ms)}</TD>
                <TD className="whitespace-nowrap">
                  {formatDate(r.closingLabel)}
                  <div className="text-[11px] text-ink-muted">{r.inProgress ? 'Month in progress — cash so far' : 'Last school day'}</div>
                </TD>
                <TD align="right" className="font-semibold text-brand-700">{cash ? peso(cash[r.closingAsOf]) : '…'}</TD>
                <TD className="whitespace-nowrap">{r.inProgress ? '—' : `${formatDate(r.carriedTo)} (opening cash)`}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
