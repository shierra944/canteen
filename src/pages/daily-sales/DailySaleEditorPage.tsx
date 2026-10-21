import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, CopyPlus, Lock, Plus, Save, ShieldAlert, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { FINANCIAL_KEYS, keys, useDailySale, useInventory, useInvalidate } from '@/lib/queries';
import { calcLine, calcTotals, canteenShares } from '@/lib/calc';
import { cn, formatDate, formatDateTime, peso, qty, toNumber, todayPH, uuid } from '@/lib/utils';
import type { DailySaleItem, InventoryItem } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Callout, ErrorState, Skeleton } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ReasonDialog } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import type { OfficialReport } from '@/lib/export/report';
import { ItemDialog } from '@/pages/inventory/dialogs';
import { ItemPicker } from './ItemPicker';

interface Line {
  key: string;
  inventory_item_id: string | null;
  item_name: string;
  consignee: string;
  total_quantity: string;
  unit_price: string;
  sold_quantity: string;
  share_quantity: string;
  shareTouched: boolean;
}

const newLine = (): Line => ({
  key: uuid(),
  inventory_item_id: null,
  item_name: '',
  consignee: '',
  total_quantity: '',
  unit_price: '',
  sold_quantity: '',
  share_quantity: '',
  shareTouched: false,
});

function fromItems(items: DailySaleItem[]): Line[] {
  return items.map((i) => ({
    key: i.id,
    inventory_item_id: i.inventory_item_id,
    item_name: i.item_name_snapshot,
    consignee: i.consignee ?? '',
    total_quantity: String(toNumber(i.total_quantity)),
    unit_price: String(toNumber(i.unit_price)),
    sold_quantity: String(toNumber(i.sold_quantity)),
    share_quantity: String(toNumber(i.share_quantity)),
    shareTouched: toNumber(i.share_quantity) !== toNumber(i.sold_quantity),
  }));
}

const n = (v: string) => (v === '' ? 0 : Number(v));

export default function DailySaleEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const { can, profile } = useAuth();
  const { settings, workingDate, schoolYears } = useApp();
  const { data, isLoading, error, refetch } = useDailySale(id);
  const { data: inventory = [] } = useInventory();
  const invById = useMemo(() => new Map(inventory.map((i) => [i.id, i])), [inventory]);

  const [date, setDate] = useState(params.get('date') ?? workingDate);
  const [actualMoney, setActualMoney] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'finalize' | 'reopen' | 'delete'>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [exception, setException] = useState<{ allow: boolean; reason: string; message: string } | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createFor, setCreateFor] = useState<{ key: string; name: string } | null>(null);
  const loadedVersion = useRef<number | null>(null);

  const sale = data?.sale;
  const locked = Boolean(sale && sale.status === 'finalized');
  const editable = !locked && can('sales.record');

  // Load server state (only when not editing locally)
  useEffect(() => {
    if (!data || dirty) return;
    setDate(data.sale.sale_date);
    setActualMoney(data.sale.actual_money === null ? '' : String(toNumber(data.sale.actual_money)));
    setRemarks(data.sale.remarks ?? '');
    setLines(data.items.length ? fromItems(data.items) : [newLine()]);
    loadedVersion.current = data.sale.version;
  }, [data, dirty]);

  // A new record for a date that already exists → open the existing one
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    supabase
      .from('daily_sales')
      .select('id')
      .eq('sale_date', date)
      .maybeSingle()
      .then(({ data: existing }) => {
        if (!cancelled && existing && !dirty) {
          toast.info(`A record for ${formatDate(date, 'long')} already exists — opening it.`);
          navigate(`/daily-sales/${existing.id}`, { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unsaved-changes protection
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const edit = (key: string, patch: Partial<Line>) => {
    setDirty(true);
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // SHARE follows SOLD (workbook: =IF(F="","",F)) unless edited by hand
        if ('sold_quantity' in patch && !next.shareTouched) next.share_quantity = next.sold_quantity;
        return next;
      }),
    );
  };
  const pick = (key: string, item: InventoryItem) =>
    edit(key, {
      inventory_item_id: item.id,
      item_name: item.name,
      unit_price: String(toNumber(item.selling_price)),
      consignee: lines.find((l) => l.key === key)?.consignee || item.default_consignee || '',
    });

  const numericLines = lines.map((l) => ({
    total_quantity: n(l.total_quantity),
    unit_price: n(l.unit_price),
    sold_quantity: n(l.sold_quantity),
    share_quantity: n(l.share_quantity),
  }));
  const totals = calcTotals(numericLines);
  const shareRate = toNumber(sale?.share_rate ?? settings?.canteen_share_rate ?? 1);
  const meaningful = lines.filter((l) => l.item_name.trim() || l.total_quantity || l.sold_quantity);
  const lineErrors = lines.map((l, i) => {
    if (!meaningful.includes(l)) return null;
    if (!l.item_name.trim()) return 'Item name is required.';
    if (l.unit_price === '') return 'Price is required.';
    return calcLine(numericLines[i]).error;
  });
  const stockWarnings = lines.map((l) => {
    if (!l.inventory_item_id || locked) return null;
    const it = invById.get(l.inventory_item_id);
    if (!it) return null;
    return n(l.sold_quantity) > toNumber(it.quantity_on_hand) ? `Only ${qty(it.quantity_on_hand)} ${it.unit} in stock` : null;
  });
  const hasErrors = lineErrors.some(Boolean) || (actualMoney !== '' && Number(actualMoney) < 0) || date > todayPH();

  async function save(): Promise<string | null> {
    if (hasErrors) {
      toast.error('Fix the highlighted rows before saving.');
      return null;
    }
    setBusy('save');
    try {
      const payload = meaningful.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        item_name: l.item_name.trim(),
        consignee: l.consignee.trim(),
        total_quantity: n(l.total_quantity),
        unit_price: n(l.unit_price),
        sold_quantity: n(l.sold_quantity),
        share_quantity: n(l.share_quantity),
      }));
      const res = await rpc<{ id: string; version: number }>('save_daily_sale', {
        p_id: id ?? null,
        p_sale_date: date,
        p_actual_money: actualMoney === '' ? null : Number(actualMoney),
        p_remarks: remarks,
        p_lines: payload,
        p_expected_version: isNew ? null : loadedVersion.current,
      });
      setDirty(false);
      loadedVersion.current = res.version;
      await invalidate([keys.dailySales, keys.alerts, keys.ledger]);
      toast.success('Draft saved.');
      if (isNew) navigate(`/daily-sales/${res.id}`, { replace: true });
      return res.id;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function finalize(allowNegative = false, reason = '') {
    const saleId = dirty || isNew ? await save() : id!;
    if (!saleId) return;
    setBusy('finalize');
    try {
      await rpc('finalize_daily_sale', { p_id: saleId, p_allow_negative: allowNegative, p_exception_reason: reason || null });
      setConfirmFinalize(false);
      setException(null);
      await invalidate(FINANCIAL_KEYS);
      await qc.invalidateQueries({ queryKey: keys.dailySales });
      toast.success('Daily sales finalized. Inventory has been updated.');
      if (isNew) navigate(`/daily-sales/${saleId}`, { replace: true });
    } catch (e) {
      const msg = (e as Error).message;
      setConfirmFinalize(false);
      if (/Insufficient stock/i.test(msg)) setException({ allow: false, reason: '', message: msg });
      else toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function reopen(reason: string) {
    setBusy('reopen');
    try {
      await rpc('reopen_daily_sale', { p_id: id, p_reason: reason });
      setReopenOpen(false);
      await invalidate(FINANCIAL_KEYS);
      toast.success('Record reopened for correction. Inventory deductions were reversed.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteDraft() {
    setBusy('delete');
    try {
      await rpc('delete_daily_sale_draft', { p_id: id });
      setDirty(false);
      await invalidate([keys.dailySales, keys.alerts, keys.ledger]);
      toast.success('Draft deleted.');
      navigate('/daily-sales', { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setDeleteOpen(false);
    }
  }

  async function copyPrevious() {
    try {
      const prev = unwrap(
        await supabase.from('daily_sales').select('id, sale_date').lt('sale_date', date).order('sale_date', { ascending: false }).limit(1).maybeSingle(),
      ) as { id: string; sale_date: string } | null;
      if (!prev) return toast.info('There is no earlier record to copy from.');
      const items = unwrap(await supabase.from('daily_sale_items').select('*').eq('daily_sale_id', prev.id).order('line_no')) as DailySaleItem[];
      setLines(
        items.map((i) => {
          const inv = i.inventory_item_id ? invById.get(i.inventory_item_id) : undefined;
          return {
            ...newLine(),
            inventory_item_id: inv?.is_active ? inv.id : null,
            item_name: i.item_name_snapshot,
            consignee: i.consignee ?? '',
            unit_price: String(inv?.is_active ? toNumber(inv.selling_price) : toNumber(i.unit_price)),
          };
        }),
      );
      setDirty(true);
      toast.success(`Copied ${items.length} items from ${formatDate(prev.sale_date, 'long')}. Enter today's quantities.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const syName = schoolYears.find((y) => date >= y.start_date && date <= y.end_date)?.name;
  const report = (): OfficialReport => ({
    title: 'Daily Canteen Sales',
    period: formatDate(date, 'long'),
    schoolYear: syName,
    filename: `QNHS-Daily-Sales-${date}`,
    orientation: 'landscape',
    columns: [
      { key: 'no', header: 'No.', width: 6 },
      { key: 'item', header: 'Item', width: 26 },
      { key: 'consignee', header: 'Consignee', width: 16 },
      { key: 'total', header: 'Total Quantity', format: 'qty', width: 11 },
      { key: 'price', header: 'Price per Piece', format: 'peso', width: 12 },
      { key: 'sold', header: 'Sold Qty', format: 'qty', width: 10 },
      { key: 'amount', header: 'Sales Amount', format: 'peso', width: 13 },
      { key: 'unsold', header: 'Unsold Qty', format: 'qty', width: 10 },
      { key: 'unsold_amount', header: 'Unsold Amount', format: 'peso', width: 13 },
      { key: 'share', header: 'Share', format: 'qty', width: 9 },
    ],
    rows: meaningful.map((l, i) => {
      const c = calcLine({ total_quantity: n(l.total_quantity), unit_price: n(l.unit_price), sold_quantity: n(l.sold_quantity), share_quantity: n(l.share_quantity) });
      return {
        no: i + 1,
        item: l.item_name,
        consignee: l.consignee,
        total: n(l.total_quantity),
        price: n(l.unit_price),
        sold: n(l.sold_quantity),
        amount: c.salesAmount,
        unsold: c.unsoldQuantity,
        unsold_amount: c.unsoldAmount,
        share: n(l.share_quantity),
      };
    }),
    totals: { item: 'TOTAL', total: totals.totalQuantity, sold: totals.unitsSold, amount: totals.salesAmount, unsold: totals.unsoldUnits, unsold_amount: totals.unsoldAmount, share: totals.shareUnits },
    summary: [
      { label: 'Daily canteen shares', value: peso(canteenShares(totals.shareUnits, shareRate)) },
      { label: 'Actual money', value: actualMoney === '' ? '—' : peso(actualMoney) },
      { label: 'Report status', value: sale?.status === 'finalized' ? 'Finalized' : 'Draft' },
    ],
    notes: [`Canteen share = share quantity × ₱${shareRate.toFixed(2)} per unit.`],
  });

  if (!isNew && error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!isNew && (isLoading || !data)) return <Skeleton className="h-[480px]" />;

  const numCell =
    'h-9 w-full min-w-[72px] rounded-lg border border-transparent bg-transparent px-2 text-right text-sm tabular hover:border-surface-border focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:hover:border-transparent';

  return (
    <>
      <div className="no-print space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/daily-sales" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
              <ArrowLeft className="size-4" /> Daily sales history
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[22px] font-semibold tracking-tight">{isNew ? 'New daily sales record' : formatDate(date, 'long')}</h2>
              {sale ? <StatusBadge status={sale.status} /> : <Badge tone="gold">New</Badge>}
              {sale && sale.correction_count > 0 && <Badge tone="blue">Corrected ×{sale.correction_count}</Badge>}
              {sale?.source === 'import' && <Badge>Imported — inventory not affected</Badge>}
              {dirty && <Badge tone="amber">Unsaved changes</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportMenu report={report} disabled={meaningful.length === 0} />
            {!isNew && sale?.status === 'draft' && sale.correction_count === 0 && sale.source === 'manual' && can('sales.record') && (
              <Button variant="danger-ghost" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete draft
              </Button>
            )}
            {locked && can('sales.correct') && (
              <Button variant="secondary" onClick={() => setReopenOpen(true)}>
                <Unlock /> Reopen for correction
              </Button>
            )}
            {editable && (
              <>
                <Button variant="secondary" onClick={() => void save()} loading={busy === 'save'} disabled={!!busy || (!dirty && !isNew)}>
                  <Save /> Save draft
                </Button>
                {can('sales.finalize') && (
                  <Button onClick={() => setConfirmFinalize(true)} disabled={!!busy || meaningful.length === 0 || hasErrors}>
                    <CheckCircle2 /> Finalize daily sales
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {locked && (
          <Callout tone="info" title="This record is finalized and locked">
            Finalized {formatDateTime(sale!.finalized_at)} by {sale!.finalized_by_name ?? '—'}.
            {sale!.inventory_posted ? ' Sold quantities were deducted from inventory.' : ''} Corrections require an authorized user to reopen the record; every change is kept in the audit log.
          </Callout>
        )}

        {/* Record information */}
        <Card>
          <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <div className="text-xs text-ink-muted">School</div>
              <div className="text-sm font-semibold">{settings?.school_name ?? 'QUIOT NATIONAL HIGH SCHOOL'}</div>
              <div className="text-xs text-ink-muted">School ID: {settings?.school_id_no ?? '312515'}</div>
            </div>
            <Field label="Date" required error={date > todayPH() ? 'Date cannot be in the future.' : null}>
              <Input type="date" value={date} max={todayPH()} disabled={!editable} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
            </Field>
            <div>
              <div className="text-xs text-ink-muted">School year</div>
              <div className="mt-2 text-sm font-medium">{syName ? `SY ${syName}` : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Recorded by</div>
              <div className="mt-2 text-sm font-medium">{sale?.created_by_name ?? profile?.full_name}</div>
            </div>
            <Field label="Actual money" hint="Cash counted for the day">
              <Input type="number" min={0} step="0.01" prefix="₱" value={actualMoney} disabled={!editable} onChange={(e) => { setActualMoney(e.target.value); setDirty(true); }} />
            </Field>
          </CardBody>
        </Card>

        {/* Line items */}
        <Card>
          <CardHeader
            title="Daily sales"
            description="Sales Amount = Sold × Price · Unsold = Total − Sold · Unsold Amount = Unsold × Price · Share = quantity sold"
            actions={
              editable && (
                <>
                  {meaningful.length === 0 && (
                    <Button variant="secondary" size="sm" onClick={() => void copyPrevious()}>
                      <CopyPlus /> Copy items from last record
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      setLines((ls) => [...ls, newLine()]);
                      setDirty(true);
                    }}
                  >
                    <Plus /> Add item
                  </Button>
                </>
              )
            }
          />
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead className="bg-surface-page/80">
                <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <th rowSpan={2} className="w-10 border-b border-surface-border px-3 py-2 text-left">No.</th>
                  <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-left">Item</th>
                  <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-left">Consignee</th>
                  <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-right">Total qty</th>
                  <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-right">Price / pc</th>
                  <th colSpan={2} className="border-b border-l border-surface-border px-2 pt-2 text-center text-brand-700">Sold</th>
                  <th colSpan={2} className="border-b border-l border-surface-border px-2 pt-2 text-center">Unsold</th>
                  <th rowSpan={2} className="border-b border-l border-surface-border px-2 py-2 text-right">Share</th>
                  <th rowSpan={2} className="w-20 border-b border-surface-border" />
                </tr>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                  <th className="border-b border-l border-surface-border px-2 pb-1.5 text-right">Qty</th>
                  <th className="border-b border-surface-border px-2 pb-1.5 text-right">Amount</th>
                  <th className="border-b border-l border-surface-border px-2 pb-1.5 text-right">Qty</th>
                  <th className="border-b border-surface-border px-2 pb-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const c = calcLine(numericLines[i]);
                  const err = lineErrors[i];
                  const warn = stockWarnings[i];
                  return (
                    <tr key={l.key} className={cn('border-b border-surface-border align-top', err && 'bg-danger-50/50')}>
                      <td className="px-3 py-2.5 text-xs text-ink-muted tabular">{i + 1}</td>
                      <td className="px-1 py-1">
                        <ItemPicker
                          value={l.item_name}
                          linkedId={l.inventory_item_id}
                          items={inventory}
                          disabled={!editable}
                          invalid={Boolean(err && !l.item_name.trim())}
                          onText={(t) => edit(l.key, { item_name: t, inventory_item_id: null })}
                          onPick={(it) => pick(l.key, it)}
                          onCreate={can('inventory.manage') ? (name) => setCreateFor({ key: l.key, name }) : undefined}
                        />
                        {(err || warn) && (
                          <div className={cn('px-2 pb-1 text-[11px]', err ? 'text-danger-600' : 'text-warn-700')}>{err ?? warn}</div>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <input
                          value={l.consignee}
                          disabled={!editable}
                          onChange={(e) => edit(l.key, { consignee: e.target.value })}
                          className="h-9 w-full min-w-[120px] rounded-lg border border-transparent bg-transparent px-2 text-sm hover:border-surface-border focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:hover:border-transparent"
                          placeholder="—"
                          aria-label={`Consignee row ${i + 1}`}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" min={0} step="any" value={l.total_quantity} disabled={!editable} onChange={(e) => edit(l.key, { total_quantity: e.target.value })} className={numCell} aria-label={`Total quantity row ${i + 1}`} />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" min={0} step="0.01" value={l.unit_price} disabled={!editable} onChange={(e) => edit(l.key, { unit_price: e.target.value })} className={numCell} aria-label={`Price row ${i + 1}`} />
                      </td>
                      <td className="border-l border-surface-border bg-brand-50/30 px-1 py-1">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={l.sold_quantity}
                          disabled={!editable}
                          onChange={(e) => edit(l.key, { sold_quantity: e.target.value })}
                          className={cn(numCell, 'font-semibold', c.error && 'text-danger-600')}
                          aria-label={`Sold quantity row ${i + 1}`}
                        />
                      </td>
                      <td className="bg-brand-50/30 px-3 py-2.5 text-right font-semibold tabular text-brand-700">{peso(c.salesAmount)}</td>
                      <td className={cn('border-l border-surface-border px-3 py-2.5 text-right tabular', c.unsoldQuantity < 0 && 'text-danger-600')}>{qty(c.unsoldQuantity)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink-muted">{peso(c.unsoldAmount)}</td>
                      <td className="border-l border-surface-border px-1 py-1">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={l.share_quantity}
                          disabled={!editable}
                          title="Defaults to the sold quantity, as in the workbook"
                          onChange={(e) => edit(l.key, { share_quantity: e.target.value, shareTouched: true })}
                          className={cn(numCell, l.shareTouched && 'text-gold-600')}
                          aria-label={`Share row ${i + 1}`}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        {editable && (
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Duplicate row"
                              aria-label={`Duplicate row ${i + 1}`}
                              onClick={() => {
                                setLines((ls) => [...ls.slice(0, i + 1), { ...l, key: uuid() }, ...ls.slice(i + 1)]);
                                setDirty(true);
                              }}
                            >
                              <Copy />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Remove row"
                              aria-label={`Remove row ${i + 1}`}
                              onClick={() => {
                                setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((x) => x.key !== l.key)));
                                setDirty(true);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-page font-semibold">
                  <td colSpan={3} className="px-3 py-3 text-right text-xs uppercase tracking-wider text-ink-muted">
                    Totals
                  </td>
                  <td className="px-3 py-3 text-right tabular">{qty(totals.totalQuantity)}</td>
                  <td />
                  <td className="border-l border-surface-border px-3 py-3 text-right tabular">{qty(totals.unitsSold)}</td>
                  <td className="px-3 py-3 text-right tabular text-brand-700">{peso(totals.salesAmount)}</td>
                  <td className="border-l border-surface-border px-3 py-3 text-right tabular">{qty(totals.unsoldUnits)}</td>
                  <td className="px-3 py-3 text-right tabular">{peso(totals.unsoldAmount)}</td>
                  <td className="border-l border-surface-border px-3 py-3 text-right tabular">{qty(totals.shareUnits)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <div className="border-t border-surface-border px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLines((ls) => [...ls, newLine()]);
                  setDirty(true);
                }}
              >
                <Plus /> Add row
              </Button>
            </div>
          )}
        </Card>

        {/* Summary */}
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader title="Remarks" />
            <CardBody>
              <Textarea value={remarks} disabled={!editable} onChange={(e) => { setRemarks(e.target.value); setDirty(true); }} placeholder="Notes for this day (optional)" rows={4} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Daily sales summary" description={locked ? 'Saved totals (calculated by the database)' : 'Recalculated as you type; saved totals are calculated by the database'} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                  ['Total units sold', qty(totals.unitsSold)],
                  ['Total sales amount', peso(totals.salesAmount)],
                  ['Total unsold units', qty(totals.unsoldUnits)],
                  ['Total unsold amount', peso(totals.unsoldAmount)],
                  ['Total share quantity', qty(totals.shareUnits)],
                  [`Daily canteen shares (× ₱${shareRate.toFixed(2)})`, peso(canteenShares(totals.shareUnits, shareRate))],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-surface-border p-3">
                    <dt className="text-xs text-ink-muted">{label}</dt>
                    <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              {locked && sale && (
                <div className="mt-4 flex items-center gap-2 text-xs text-brand-700">
                  <Lock className="size-3.5" /> Database totals: {peso(sale.sales_amount)} sales · {qty(sale.units_sold)} units · {peso(sale.canteen_shares)} canteen shares
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <PrintableReport report={meaningful.length ? report() : null} />

      {/* Dialogs */}
      <ConfirmDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        title={`Finalize sales for ${formatDate(date, 'long')}?`}
        description={
          <div className="space-y-2">
            <p>
              {meaningful.length} items · {qty(totals.unitsSold)} units sold · {peso(totals.salesAmount)}.
            </p>
            <p>Sold quantities of inventory-linked items will be deducted from stock, and the record will be locked. Corrections afterwards require an authorized reopen.</p>
          </div>
        }
        confirmLabel="Finalize"
        loading={busy === 'finalize' || busy === 'save'}
        onConfirm={() => void finalize()}
      />
      <ConfirmDialog
        open={Boolean(exception)}
        onOpenChange={(o) => !o && setException(null)}
        title="Not enough stock"
        description={exception?.message}
        confirmLabel={can('inventory.negative_exception') ? 'Finalize with exception' : 'OK'}
        tone="danger"
        loading={busy === 'finalize'}
        confirmDisabled={can('inventory.negative_exception') && (!exception?.allow || (exception?.reason.trim().length ?? 0) < 5)}
        onConfirm={() => (can('inventory.negative_exception') ? void finalize(true, exception!.reason) : setException(null))}
      >
        {can('inventory.negative_exception') ? (
          <div className="space-y-3">
            <Checkbox
              checked={exception?.allow ?? false}
              onChange={(v) => setException((s) => s && { ...s, allow: v })}
              label="Authorise a documented negative-stock exception"
              description="Use only when stock was physically available but not yet encoded (e.g. an unrecorded delivery)."
            />
            <Field label="Justification" required>
              <Textarea value={exception?.reason ?? ''} onChange={(e) => setException((s) => s && { ...s, reason: e.target.value })} />
            </Field>
          </div>
        ) : (
          <Callout tone="warning" title="What to do">
            Record the stock-in for the delivery first, or correct the sold quantity. An administrator can authorise an exception.
          </Callout>
        )}
      </ConfirmDialog>
      <ReasonDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reopen for correction?"
        description={
          <span className="flex gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn-600" />
            The inventory deductions from this record will be reversed through auditable correction entries, and the record returns to draft. Finalize it again after correcting.
          </span>
        }
        confirmLabel="Reopen record"
        tone="primary"
        loading={busy === 'reopen'}
        onConfirm={(r) => void reopen(r)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this draft?"
        description="The draft was never finalized, so no inventory or financial totals are affected. The deletion is recorded in the audit log."
        confirmLabel="Delete draft"
        tone="danger"
        loading={busy === 'delete'}
        onConfirm={() => void deleteDraft()}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Leave without saving?"
        description="You have unsaved changes to this daily sales record."
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
      <ItemDialog
        open={Boolean(createFor)}
        onOpenChange={(o) => !o && setCreateFor(null)}
        initialName={createFor?.name}
        onSaved={async (newId) => {
          const key = createFor?.key;
          await qc.invalidateQueries({ queryKey: keys.inventory });
          const { data: it } = await supabase.from('v_inventory_items').select('*').eq('id', newId).single();
          if (it && key) pick(key, it as InventoryItem);
        }}
      />
      {busy === 'save' && <span className="sr-only">Saving…</span>}
    </>
  );
}
