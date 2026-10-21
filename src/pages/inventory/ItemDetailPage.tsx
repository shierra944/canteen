import { useMemo, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, History, PackagePlus, Pencil, SlidersHorizontal, Undo2, XCircle } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { rpc } from '@/lib/supabase';
import { useAction, useInventoryItem, useInventoryMovement, useProfilesMap } from '@/lib/queries';
import { INV_TYPE_LABEL } from '@/lib/labels';
import { resolvePeriod, type Period } from '@/lib/periods';
import { cn, formatDate, formatDateTime, peso, qty, toNumber } from '@/lib/utils';
import { useApp } from '@/providers/app';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge, StockBadge } from '@/components/ui/badge';
import { Callout, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { KeyValue, PeriodPicker, ReasonDialog } from '@/components/shared';
import type { StockReceipt } from '@/lib/types';
import { AdjustDialog, ItemDialog, StockInDialog } from './dialogs';

export default function ItemDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { workingDate } = useApp();
  const { data, isLoading, error, refetch } = useInventoryItem(id);
  const { data: names = {} } = useProfilesMap();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('this_month', workingDate));
  const movement = useInventoryMovement(period.start, period.end);
  const mv = movement.data?.find((m) => m.item_id === id);
  const [edit, setEdit] = useState(false);
  const [stockIn, setStockIn] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [reverse, setReverse] = useState<StockReceipt | null>(null);
  const reverseReceipt = useAction((reason: string) => rpc('reverse_stock_in', { p_receipt_id: reverse!.id, p_reason: reason }), {
    success: 'Stock receipt reversed.',
    onSuccess: () => setReverse(null),
  });

  const [ledgerFilter, setLedgerFilter] = useState<{ label: string; types: string[] | null; inPeriod: boolean } | null>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const allTxns = useMemo(() => data?.txns ?? [], [data]);
  // the ledger rows behind the clicked tile (period tiles use the selected period)
  const txns = useMemo(() => {
    if (!ledgerFilter) return allTxns;
    return allTxns.filter((t) => {
      const inRange = t.txn_date >= period.start && t.txn_date <= period.end;
      if (ledgerFilter.label === 'Opening stock') return t.txn_date < period.start;
      if (ledgerFilter.label === 'Closing stock') return t.txn_date <= period.end;
      return (!ledgerFilter.inPeriod || inRange) && (!ledgerFilter.types || ledgerFilter.types.includes(t.transaction_type));
    });
  }, [allTxns, ledgerFilter, period]);
  const showLedger = (label: string, types: string[] | null, inPeriod = true) => {
    setLedgerFilter({ label, types, inPeriod });
    requestAnimationFrame(() => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { item, receipts } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/inventory" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Products & Consignees
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[22px] font-semibold tracking-tight">{item.name}</h2>
            {item.is_active ? <StockBadge status={item.stock_status} /> : <Badge>Archived</Badge>}
          </div>
          <p className="mt-1 font-mono text-xs text-ink-muted">{item.item_code}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('inventory.manage') && (
            <Button variant="secondary" onClick={() => setEdit(true)}>
              <Pencil /> Edit
            </Button>
          )}
          {can('inventory.adjust') && item.is_active && !item.is_consigned && (
            <Button variant="secondary" onClick={() => setAdjust(true)}>
              <SlidersHorizontal /> Adjust
            </Button>
          )}
          {can('inventory.stock_in') && item.is_active && !item.is_consigned && (
            <Button onClick={() => setStockIn(true)}>
              <PackagePlus /> Stock-in
            </Button>
          )}
        </div>
      </div>

      <div className={item.is_consigned ? 'grid gap-6' : 'grid gap-6 lg:grid-cols-[1fr_1.4fr]'}>
        <Card>
          <CardHeader title="Item details" />
          <CardBody>
            {item.is_consigned ? (
              <div className="mb-5 rounded-xl bg-info-50 p-4 text-sm">
                <div className="font-semibold text-info-600">Consigned item — {item.consignee_name}</div>
                <div className="mt-1 text-ink-muted">Sold through daily sales; not counted as canteen stock, so there is no stock-in, adjustment or stock alert.</div>
                <div className="mt-3 flex gap-6">
                  <span>Selling {peso(item.selling_price)}</span>
                  <span>Cost {peso(item.unit_cost)}</span>
                  <span className="font-semibold">Margin {peso(toNumber(item.selling_price) - toNumber(item.unit_cost))}</span>
                </div>
              </div>
            ) : (
            <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-brand-50 p-4">
              <div>
                <div className="text-xs text-ink-muted">Quantity on hand</div>
                <div className="tabular text-2xl font-semibold text-brand-700">
                  {qty(item.quantity_on_hand)} <span className="text-sm font-normal text-ink-muted">{item.unit}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Stock value</div>
                <div className="tabular text-2xl font-semibold text-brand-700">{peso(item.stock_value)}</div>
              </div>
            </div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <KeyValue label="Category">{item.category_name ?? '—'}</KeyValue>
              <KeyValue label="Unit">{item.unit}</KeyValue>
              <KeyValue label="Cost per unit">{peso(item.unit_cost)}</KeyValue>
              <KeyValue label="Selling price">{peso(item.selling_price)}</KeyValue>
              <KeyValue label="Reorder level">{qty(item.reorder_level)}</KeyValue>
              <KeyValue label="Supplier">{item.supplier_name ?? '—'}</KeyValue>
              <KeyValue label={item.is_consigned ? 'Consignee' : 'Default consignee'}>{item.consignee_name ?? item.default_consignee ?? '—'}</KeyValue>
              <KeyValue label="Expiration date">{formatDate(item.expiration_date)}</KeyValue>
              {item.description && (
                <KeyValue label="Description" className="col-span-2">
                  {item.description}
                </KeyValue>
              )}
            </dl>
          </CardBody>
        </Card>

        {!item.is_consigned && (
        <Card>
          <CardHeader title="Movement summary" description="Opening + received − sold − losses ± adjustments = closing" actions={<PeriodPicker value={period} onChange={setPeriod} presets={['this_week', 'this_month', 'this_quarter', 'school_year', 'custom']} />} />
          <CardBody>
            {!mv ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ['Opening stock', mv.opening, '', null],
                    ['Stock received', mv.received, 'text-brand-600', ['opening', 'stock_in', 'stock_in_reversal']],
                    ['Quantity sold', mv.sold, '', ['sale', 'sale_reversal']],
                    ['Damaged / expired / spoiled / missing', mv.losses, 'text-danger-600', ['damaged', 'expired', 'spoiled', 'missing']],
                    ['Other adjustments', mv.other_adjustments, '', ['count_correction', 'other_adjustment']],
                    ['Closing stock', mv.closing, 'text-brand-700', null],
                  ].map(([label, v, cls, types]) => (
                    <button
                      type="button"
                      key={label as string}
                      onClick={() => showLedger(label as string, types as string[] | null)}
                      className={cn(
                        'group rounded-xl border p-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/40',
                        ledgerFilter?.label === label ? 'border-brand-500 bg-brand-50/50' : 'border-surface-border',
                      )}
                    >
                      <div className="text-xs text-ink-muted">{label as string}</div>
                      <div className={`tabular mt-1 text-lg font-semibold ${cls}`}>{qty(v)}</div>
                      <div className="mt-1 text-[11px] font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">View movements →</div>
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  {mv.reconciled ? (
                    <div className="flex items-center gap-2 text-sm text-brand-700">
                      <CheckCircle2 className="size-4" /> Movement history reconciles with the current balance ({qty(mv.ledger_balance)} {item.unit}).
                    </div>
                  ) : (
                    <Callout tone="danger" title="Ledger mismatch">
                      Quantity on hand ({qty(mv.quantity_on_hand)}) differs from the movement history total ({qty(mv.ledger_balance)}).
                    </Callout>
                  )}
                </div>
              </>
            )}
          </CardBody>
        </Card>
        )}
      </div>

      {!item.is_consigned && (
      <Card>
        <div ref={ledgerRef} className="scroll-mt-20" />
        <CardHeader
          title="Stock ledger"
          description={ledgerFilter ? `Showing: ${ledgerFilter.label}${ledgerFilter.label === 'Opening stock' ? ` (before ${formatDate(period.start)})` : ledgerFilter.label === 'Closing stock' ? ` (up to ${formatDate(period.end)})` : ` · ${formatDate(period.start)} – ${formatDate(period.end)}`}` : 'Permanent record of every stock movement'}
          icon={<History />}
          actions={
            ledgerFilter && (
              <Button variant="ghost" size="sm" onClick={() => setLedgerFilter(null)}>
                Show all movements
              </Button>
            )
          }
        />
        {txns.length === 0 ? (
          <EmptyState icon={<History />} title={ledgerFilter ? 'No movements of this kind in the period' : 'No stock movements yet'} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>#</TH>
                <TH>Date</TH>
                <TH>Movement</TH>
                <TH align="right">Change</TH>
                <TH align="right">Balance</TH>
                <TH>Reason / reference</TH>
                <TH>By</TH>
                <TH>Recorded</TH>
              </tr>
            </THead>
            <tbody>
              {txns.map((t) => {
                const q = toNumber(t.quantity);
                return (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs text-ink-muted">INV-{t.txn_no}</TD>
                    <TD className="whitespace-nowrap">{formatDate(t.txn_date)}</TD>
                    <TD className="whitespace-nowrap">
                      {INV_TYPE_LABEL[t.transaction_type]}
                      {t.is_exception && (
                        <Badge tone="red" className="ml-2">
                          Exception
                        </Badge>
                      )}
                    </TD>
                    <TD align="right" className={q < 0 ? 'font-semibold text-danger-600' : 'font-semibold text-brand-600'}>
                      {q > 0 ? '+' : ''}
                      {qty(q)}
                    </TD>
                    <TD align="right">{qty(t.balance_after)}</TD>
                    <TD className="max-w-[320px] text-ink-muted">
                      {t.reference_type === 'daily_sale_item' ? <span>{t.reason}</span> : t.reason ?? '—'}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">{(t.created_by && names[t.created_by]) || '—'}</TD>
                    <TD className="whitespace-nowrap text-xs text-ink-muted">{formatDateTime(t.created_at)}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      )}

      {receipts.length > 0 && (
        <Card>
          <CardHeader title="Stock receipts" icon={<PackagePlus />} />
          <Table>
            <THead>
              <tr>
                <TH>Receipt</TH>
                <TH>Date received</TH>
                <TH align="right">Qty</TH>
                <TH align="right">Cost / unit</TH>
                <TH align="right">Total</TH>
                <TH>Reference</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {receipts.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs text-ink-muted">SR-{r.receipt_no}</TD>
                  <TD>{formatDate(r.date_received)}</TD>
                  <TD align="right">{qty(r.quantity)}</TD>
                  <TD align="right">{peso(r.unit_cost)}</TD>
                  <TD align="right" className="font-medium">
                    {peso(r.total_cost)}
                  </TD>
                  <TD className="text-ink-muted">{r.reference_no ?? '—'}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                    {r.reversal_reason && <div className="mt-1 text-xs text-ink-muted">{r.reversal_reason}</div>}
                  </TD>
                  <TD align="right">
                    {r.status === 'posted' && can('inventory.adjust') && (
                      <Button variant="danger-ghost" size="sm" onClick={() => setReverse(r)}>
                        <Undo2 /> Reverse
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <ItemDialog open={edit} onOpenChange={setEdit} item={item} />
      <StockInDialog open={stockIn} onOpenChange={setStockIn} itemId={item.id} />
      <AdjustDialog open={adjust} onOpenChange={setAdjust} item={item} />
      <ReasonDialog
        open={Boolean(reverse)}
        onOpenChange={(o) => !o && setReverse(null)}
        title={`Reverse stock receipt SR-${reverse?.receipt_no}?`}
        description={
          <span className="flex items-start gap-2">
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger-500" />
            Removes {qty(reverse?.quantity)} {item.unit} from stock and marks the receipt (and any linked expense) as reversed. The original entry stays in the ledger.
          </span>
        }
        confirmLabel="Reverse receipt"
        loading={reverseReceipt.isPending}
        onConfirm={(reason) => reverseReceipt.mutate(reason)}
      />
    </div>
  );
}
