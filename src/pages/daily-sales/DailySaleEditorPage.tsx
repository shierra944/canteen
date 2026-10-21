import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, CopyPlus, HandCoins, Lock, Plus, Save, Scale, ShieldAlert, Trash2, TrendingUp, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { FINANCIAL_KEYS, keys, useConsignees, useDailySale, useDailySummary, useInventory, useInvalidate } from '@/lib/queries';
import { calcLine, calcTotals, lineMoney } from '@/lib/calc';
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
  cost_price: string;
  is_canteen_stock: boolean;
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
  cost_price: '',
  is_canteen_stock: false,
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
    cost_price: i.cost_price === null ? '' : String(toNumber(i.cost_price)),
    is_canteen_stock: i.is_canteen_stock,
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
  const { data: consignees = [] } = useConsignees();
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
      consignee: item.is_consigned ? item.consignee_name ?? '' : lines.find((l) => l.key === key)?.consignee || item.default_consignee || '',
      is_canteen_stock: !item.is_consigned,
      cost_price: item.is_consigned && toNumber(item.unit_cost) > 0 ? String(toNumber(item.unit_cost)) : '',
    });

  const numericLines = lines.map((l) => ({
    total_quantity: n(l.total_quantity),
    unit_price: n(l.unit_price),
    sold_quantity: n(l.sold_quantity),
    share_quantity: n(l.share_quantity),
    cost_price: l.is_canteen_stock || l.cost_price === '' ? null : Number(l.cost_price),
    is_canteen_stock: l.is_canteen_stock,
  }));
  const totals = calcTotals(numericLines);
  const shareRate = toNumber(sale?.share_rate ?? settings?.canteen_share_rate ?? 1);
  const money = numericLines.map((l) => lineMoney(l, shareRate));
  const shareTotal = Math.round(money.reduce((a, m) => a + m.canteenShare, 0) * 100) / 100;
  const remitTotal = Math.round(money.reduce((a, m) => a + m.remit, 0) * 100) / 100;
  // Other shares / expenses / deficit recorded for the same day (posted transactions)
  const { data: dayRows } = useDailySummary(date, date);
  const fin = dayRows?.[0];
  const otherShares = toNumber(fin?.other_shares);
  const dayExpenses = toNumber(fin?.expenses);
  const dayDeficit = toNumber(fin?.deficit);
  const deductDeficit = settings?.deduct_deficit_in_net !== false;
  const grossSales = Math.round((shareTotal + otherShares) * 100) / 100;
  const netSales = Math.round((grossSales - dayExpenses - (deductDeficit ? dayDeficit : 0)) * 100) / 100;
  const byConsignee = useMemo(() => {
    const m = new Map<string, { consignee: string; items: number; sold: number; sales: number; share: number; remit: number }>();
    lines.forEach((l, i) => {
      if (!l.item_name.trim() || l.is_canteen_stock) return;
      const k = l.consignee.trim() || '(no consignee)';
      const g = m.get(k.toLowerCase()) ?? { consignee: k, items: 0, sold: 0, sales: 0, share: 0, remit: 0 };
      g.items += 1;
      g.sold += numericLines[i].sold_quantity;
      g.sales += calcLine(numericLines[i]).salesAmount;
      g.share += money[i].canteenShare;
      g.remit += money[i].remit;
      m.set(k.toLowerCase(), g);
    });
    return [...m.values()].sort((a, b) => a.consignee.localeCompare(b.consignee));
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const meaningful = lines.filter((l) => l.item_name.trim() || l.total_quantity || l.sold_quantity);
  const lineErrors = lines.map((l, i) => {
    if (!meaningful.includes(l)) return null;
    if (!l.item_name.trim()) return 'Item name is required.';
    if (l.unit_price === '') return 'Price is required.';
    if (!l.is_canteen_stock && l.cost_price !== '' && Number(l.cost_price) > n(l.unit_price)) return 'Cost price is higher than the selling price.';
    return calcLine(numericLines[i]).error;
  });
  const stockWarnings = lines.map((l) => {
    if (!l.inventory_item_id || locked) return null;
    const it = invById.get(l.inventory_item_id);
    if (!it || it.is_consigned) return null;
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
        cost_price: l.is_canteen_stock || l.cost_price === '' ? null : Number(l.cost_price),
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
            is_canteen_stock: Boolean(inv?.is_active && !inv.is_consigned),
            cost_price: inv?.is_active ? (inv.is_consigned && toNumber(inv.unit_cost) > 0 ? String(toNumber(inv.unit_cost)) : '') : i.cost_price === null ? '' : String(toNumber(i.cost_price)),
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
      { key: 'cost', header: 'Cost Price', format: 'peso', width: 11 },
      { key: 'price', header: 'Selling Price', format: 'peso', width: 11 },
      { key: 'total', header: 'Total Qty', format: 'qty', width: 9 },
      { key: 'sold', header: 'Sold', format: 'qty', width: 8 },
      { key: 'unsold', header: 'Unsold', format: 'qty', width: 8 },
      { key: 'amount', header: 'Sales Amount', format: 'peso', width: 13 },
      { key: 'canteen_share', header: 'Canteen Share', format: 'peso', width: 13 },
      { key: 'remit', header: 'Remit to Consignee', format: 'peso', width: 14 },
    ],
    rows: lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => meaningful.includes(l))
      .map(({ l, i }, idx) => {
        const c = calcLine(numericLines[i]);
        return {
          no: idx + 1,
          item: l.item_name,
          consignee: l.is_canteen_stock ? 'Canteen stock' : l.consignee,
          cost: l.is_canteen_stock || l.cost_price === '' ? null : Number(l.cost_price),
          price: n(l.unit_price),
          total: n(l.total_quantity),
          sold: n(l.sold_quantity),
          unsold: c.unsoldQuantity,
          amount: c.salesAmount,
          canteen_share: money[i].canteenShare,
          remit: money[i].remit,
        };
      }),
    totals: { item: 'TOTAL', total: totals.totalQuantity, sold: totals.unitsSold, unsold: totals.unsoldUnits, amount: totals.salesAmount, canteen_share: shareTotal, remit: remitTotal },
    sections: byConsignee.length
      ? [{
          title: 'Remittance by consignee',
          columns: [
            { key: 'consignee', header: 'Consignee' },
            { key: 'items', header: 'Items', format: 'qty' },
            { key: 'sold', header: 'Pieces Sold', format: 'qty' },
            { key: 'sales', header: 'Sales', format: 'peso' },
            { key: 'share', header: 'Canteen Share', format: 'peso' },
            { key: 'remit', header: 'Amount to Remit', format: 'peso' },
          ],
          rows: byConsignee.map((g) => ({ ...g })),
          totals: { consignee: 'TOTAL', sales: byConsignee.reduce((a, g) => a + g.sales, 0), share: byConsignee.reduce((a, g) => a + g.share, 0), remit: remitTotal },
        }]
      : undefined,
    summary: [
      { label: 'Daily canteen shares', value: peso(shareTotal) },
      { label: 'Other shares', value: peso(otherShares) },
      { label: 'Gross sales', value: peso(grossSales), emphasis: true },
      { label: 'Expenses', value: peso(dayExpenses) },
      { label: 'Deficit', value: peso(dayDeficit) },
      { label: 'Net sales', value: peso(netSales), emphasis: true },
      { label: 'Total to remit to consignees', value: peso(remitTotal) },
      { label: 'Actual money', value: actualMoney === '' ? '—' : peso(actualMoney) },
      { label: 'Report status', value: sale?.status === 'finalized' ? 'Finalized' : 'Draft' },
    ],
    notes: [`Canteen share: consigned items with a cost price = (selling − cost) × qty; without a cost price = ₱${shareRate.toFixed(2)} × qty; canteen stock = full sales. Remittance = sales − canteen share.`],
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

        {/* Canteen result for the day */}
        <div className="grid gap-4 md:grid-cols-[1.1fr_1.1fr_1.6fr]">
          <div className="card p-5">
            <div className="flex items-center justify-between text-[13px] font-medium text-ink-muted">
              Gross sales (canteen) <TrendingUp className="size-4 text-brand-600" />
            </div>
            <div className="tabular mt-1 text-[28px] font-semibold tracking-tight text-brand-700">{peso(grossSales)}</div>
            <div className="mt-1 text-xs text-ink-muted">
              Canteen shares {peso(shareTotal)} + other shares {peso(otherShares)}
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between text-[13px] font-medium text-ink-muted">
              Net sales (canteen) <Scale className="size-4 text-brand-600" />
            </div>
            <div className={cn('tabular mt-1 text-[28px] font-semibold tracking-tight', netSales < 0 ? 'text-danger-600' : 'text-ink')}>{peso(netSales)}</div>
            <div className="mt-1 text-xs text-ink-muted">
              − expenses {peso(dayExpenses)}
              {deductDeficit ? ` − deficit ${peso(dayDeficit)}` : ''}
            </div>
          </div>
          <div className="card grid grid-cols-3 divide-x divide-surface-border p-0">
            <div className="p-5">
              <div className="text-[13px] font-medium text-ink-muted">Sales collected</div>
              <div className="tabular mt-1 text-xl font-semibold">{peso(totals.salesAmount)}</div>
              <div className="mt-1 text-xs text-ink-muted">{qty(totals.unitsSold)} pcs sold</div>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted">
                <HandCoins className="size-4 text-gold-600" /> To remit
              </div>
              <div className="tabular mt-1 text-xl font-semibold text-gold-600">{peso(remitTotal)}</div>
              <div className="mt-1 text-xs text-ink-muted">{byConsignee.length} consignees</div>
            </div>
            <div className="p-5">
              <div className="text-[13px] font-medium text-ink-muted">Actual money</div>
              <div className="tabular mt-1 text-xl font-semibold">{actualMoney === '' ? '—' : peso(actualMoney)}</div>
              <div className="mt-1 text-xs text-ink-muted">cash counted</div>
            </div>
          </div>
        </div>
        {!locked && (
          <p className="-mt-3 text-xs text-ink-muted">
            Figures update as you type. Other shares, expenses and deficits come from Expenses &amp; Other Sales for this date{fin ? '' : ' (none recorded yet)'}.
          </p>
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
            title="Daily sales sheet"
            description={`Sales = Sold × Selling price · Canteen share = (Selling − Cost) × Sold, or ₱${shareRate.toFixed(2)} × Sold when no cost price · Remit = Sales − Canteen share`}
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
            <table className="w-full min-w-[1240px] border-collapse text-sm">
              <thead className="bg-surface-page/80">
                <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <th rowSpan={2} className="w-10 border-b border-surface-border px-3 py-2 text-left">No.</th>
                  <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-left">Item</th>
                  <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-left">Consignee</th>
                  <th colSpan={2} className="border-b border-l border-surface-border px-2 pt-2 text-center">Price per piece</th>
                  <th colSpan={3} className="border-b border-l border-surface-border px-2 pt-2 text-center">Quantity</th>
                  <th rowSpan={2} className="border-b border-l border-surface-border px-2 py-2 text-right">Sales</th>
                  <th rowSpan={2} className="border-b border-surface-border bg-brand-50/60 px-2 py-2 text-right text-brand-700">Canteen share</th>
                  <th rowSpan={2} className="border-b border-surface-border bg-gold-50/70 px-2 py-2 text-right text-gold-600">Remit to consignee</th>
                  <th rowSpan={2} className="border-b border-l border-surface-border px-2 py-2 text-right" title="Workbook SHARE column (quantity)">Share qty</th>
                  <th rowSpan={2} className="w-20 border-b border-surface-border" />
                </tr>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                  <th className="border-b border-l border-surface-border px-2 pb-1.5 text-right">Cost</th>
                  <th className="border-b border-surface-border px-2 pb-1.5 text-right">Selling</th>
                  <th className="border-b border-l border-surface-border px-2 pb-1.5 text-right">Total</th>
                  <th className="border-b border-surface-border px-2 pb-1.5 text-right">Sold</th>
                  <th className="border-b border-surface-border px-2 pb-1.5 text-right">Unsold</th>
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
                          onText={(t) => edit(l.key, { item_name: t, inventory_item_id: null, is_canteen_stock: false })}
                          onPick={(it) => pick(l.key, it)}
                          onCreate={can('inventory.manage') ? (name) => setCreateFor({ key: l.key, name }) : undefined}
                        />
                        {(err || warn) && (
                          <div className={cn('px-2 pb-1 text-[11px]', err ? 'text-danger-600' : 'text-warn-700')}>{err ?? warn}</div>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {l.is_canteen_stock ? (
                          <div className="px-2 py-2 text-xs font-medium text-brand-700">Canteen stock</div>
                        ) : (
                        <input
                          value={l.consignee}
                          disabled={!editable}
                          onChange={(e) => edit(l.key, { consignee: e.target.value })}
                          className="h-9 w-full min-w-[120px] rounded-lg border border-transparent bg-transparent px-2 text-sm hover:border-surface-border focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:hover:border-transparent"
                          placeholder="—"
                          list="consignee-options"
                          aria-label={`Consignee row ${i + 1}`}
                        />
                        )}
                      </td>
                      <td className="border-l border-surface-border px-1 py-1">
                        {l.is_canteen_stock ? (
                          <div className="px-2 py-2 text-right text-ink-soft">—</div>
                        ) : (
                          <input type="number" min={0} step="0.01" value={l.cost_price} placeholder="—" disabled={!editable} title={`Blank = ₱${shareRate.toFixed(2)} per piece to the canteen`} onChange={(e) => edit(l.key, { cost_price: e.target.value })} className={numCell} aria-label={`Cost price row ${i + 1}`} />
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" min={0} step="0.01" value={l.unit_price} disabled={!editable} onChange={(e) => edit(l.key, { unit_price: e.target.value })} className={numCell} aria-label={`Selling price row ${i + 1}`} />
                      </td>
                      <td className="border-l border-surface-border px-1 py-1">
                        <input type="number" min={0} step="any" value={l.total_quantity} disabled={!editable} onChange={(e) => edit(l.key, { total_quantity: e.target.value })} className={numCell} aria-label={`Total quantity row ${i + 1}`} />
                      </td>
                      <td className="px-1 py-1">
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
                      <td className={cn('px-3 py-2.5 text-right tabular', c.unsoldQuantity < 0 && 'text-danger-600')}>{qty(c.unsoldQuantity)}</td>
                      <td className="border-l border-surface-border px-3 py-2.5 text-right font-medium tabular">{peso(c.salesAmount)}</td>
                      <td className="bg-brand-50/40 px-3 py-2.5 text-right font-semibold tabular text-brand-700">{peso(money[i].canteenShare)}</td>
                      <td className="bg-gold-50/50 px-3 py-2.5 text-right font-semibold tabular text-gold-600">{l.is_canteen_stock ? <span className="font-normal text-ink-soft">—</span> : peso(money[i].remit)}</td>
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
                  <td colSpan={5} className="px-3 py-3 text-right text-xs uppercase tracking-wider text-ink-muted">
                    Totals
                  </td>
                  <td className="border-l border-surface-border px-3 py-3 text-right tabular">{qty(totals.totalQuantity)}</td>
                  <td className="px-3 py-3 text-right tabular">{qty(totals.unitsSold)}</td>
                  <td className="px-3 py-3 text-right tabular">{qty(totals.unsoldUnits)}</td>
                  <td className="border-l border-surface-border px-3 py-3 text-right tabular">{peso(totals.salesAmount)}</td>
                  <td className="bg-brand-50/60 px-3 py-3 text-right tabular text-brand-700">{peso(shareTotal)}</td>
                  <td className="bg-gold-50/70 px-3 py-3 text-right tabular text-gold-600">{peso(remitTotal)}</td>
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
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Remittance by consignee" description="Money to hand over to each consignee for this day" icon={<HandCoins />} />
            {byConsignee.length === 0 ? (
              <CardBody className="text-sm text-ink-muted">No consigned items on this sheet yet.</CardBody>
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-page/80 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Consignee</th>
                      <th className="px-4 py-2.5 text-right">Items</th>
                      <th className="px-4 py-2.5 text-right">Pcs sold</th>
                      <th className="px-4 py-2.5 text-right">Sales</th>
                      <th className="px-4 py-2.5 text-right">Canteen share</th>
                      <th className="px-4 py-2.5 text-right">To remit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byConsignee.map((g) => (
                      <tr key={g.consignee} className="border-t border-surface-border">
                        <td className="px-4 py-2.5 font-medium">{g.consignee}</td>
                        <td className="px-4 py-2.5 text-right tabular">{g.items}</td>
                        <td className="px-4 py-2.5 text-right tabular">{qty(g.sold)}</td>
                        <td className="px-4 py-2.5 text-right tabular">{peso(g.sales)}</td>
                        <td className="px-4 py-2.5 text-right tabular text-brand-700">{peso(g.share)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular text-gold-600">{peso(g.remit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-surface-border bg-surface-page font-semibold">
                      <td className="px-4 py-2.5" colSpan={3}>Total</td>
                      <td className="px-4 py-2.5 text-right tabular">{peso(byConsignee.reduce((a, g) => a + g.sales, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular text-brand-700">{peso(byConsignee.reduce((a, g) => a + g.share, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular text-gold-600">{peso(remitTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {locked && sale && (
              <div className="flex items-center gap-2 border-t border-surface-border px-5 py-3 text-xs text-brand-700">
                <Lock className="size-3.5" /> Database totals: {peso(sale.sales_amount)} sales · {peso(sale.canteen_shares)} canteen shares · {peso(sale.remit_total)} remittance
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Remarks" />
            <CardBody>
              <Textarea value={remarks} disabled={!editable} onChange={(e) => { setRemarks(e.target.value); setDirty(true); }} placeholder="Notes for this day (optional)" rows={4} />
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
      <datalist id="consignee-options">
        {consignees.filter((c) => c.is_active).map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {busy === 'save' && <span className="sr-only">Saving…</span>}
    </>
  );
}
