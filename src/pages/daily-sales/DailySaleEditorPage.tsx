import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  HandCoins,
  History,
  Cloud,
  CloudCheck,
  CloudOff,
  Loader2,
  Lock,
  Plus,
  Save,
  Scale,
  ShieldAlert,
  Sheet,
  Trash2,
  TrendingUp,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { rpc, supabase } from '@/lib/supabase';
import { FINANCIAL_KEYS, keys, useConsignees, useDailySale, useDailySummary, useInventory, useInvalidate } from '@/lib/queries';
import { calcLine, calcTotals, lineMoney } from '@/lib/calc';
import { cn, formatDate, formatDateTime, peso, qty, toNumber, todayPH, uuid } from '@/lib/utils';
import type { DailySaleItem, InventoryItem } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea, needsInputClass } from '@/components/ui/form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Callout, ErrorState, Skeleton } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReasonDialog } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import type { OfficialReport } from '@/lib/export/report';
import { ItemDialog } from '@/pages/inventory/dialogs';
import { SheetCombobox, type ComboOption } from './SheetCombobox';
import { HistoryPanel, type HistoryLine } from './HistoryPanel';

interface Line {
  key: string;
  inventory_item_id: string | null;
  item_name: string;
  itemManual: boolean;
  consignee: string;
  consigneeManual: boolean;
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
  itemManual: false,
  consignee: '',
  consigneeManual: false,
  total_quantity: '',
  unit_price: '',
  sold_quantity: '',
  share_quantity: '',
  shareTouched: false,
  cost_price: '',
  is_canteen_stock: false,
});

const num = (v: unknown) => String(toNumber(v));

function fromItems(items: DailySaleItem[], consigneeNames: Set<string>): Line[] {
  return items.map((i) => ({
    key: i.id,
    inventory_item_id: i.inventory_item_id,
    item_name: i.item_name_snapshot,
    itemManual: !i.inventory_item_id,
    consignee: i.consignee ?? '',
    consigneeManual: Boolean(i.consignee) && !consigneeNames.has((i.consignee ?? '').trim().toLowerCase()),
    total_quantity: num(i.total_quantity),
    unit_price: num(i.unit_price),
    sold_quantity: num(i.sold_quantity),
    share_quantity: num(i.share_quantity),
    shareTouched: toNumber(i.share_quantity) !== toNumber(i.sold_quantity),
    cost_price: i.cost_price === null ? '' : num(i.cost_price),
    is_canteen_stock: i.is_canteen_stock,
  }));
}

const n = (v: string) => (v === '' ? 0 : Number(v));

export default function DailySaleEditorPage() {
  const { id: routeId } = useParams();
  // the record id lives in state so the first auto-save can create the record
  // without remounting the page (and losing the cursor)
  const [recordId, setRecordId] = useState<string | undefined>(routeId);
  useEffect(() => setRecordId(routeId), [routeId]);
  const id = recordId;
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
  const consigneeNames = useMemo(() => new Set(consignees.map((c) => c.name.trim().toLowerCase())), [consignees]);

  const [date, setDate] = useState(params.get('date') ?? workingDate);
  const [actualMoney, setActualMoney] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'sheet' | 'history'>('sheet');
  const [busy, setBusy] = useState<null | 'save' | 'finalize' | 'reopen' | 'delete'>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [exception, setException] = useState<{ allow: boolean; reason: string; message: string } | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createFor, setCreateFor] = useState<{ key: string; name: string } | null>(null);
  const loadedVersion = useRef<number | null>(null);
  // auto-save bookkeeping
  const rev = useRef(0); // bumps on every edit
  const loadedKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: Date; message?: string }>({ kind: 'idle' });
  const [autoBlocked, setAutoBlocked] = useState(false);
  const [kick, setKick] = useState(0); // re-run auto-save after an in-flight save
  const focusRow = useRef<number | null>(null);
  const touch = () => {
    rev.current += 1;
    setDirty(true);
  };

  const sale = data?.sale;
  const locked = Boolean(sale && sale.status === 'finalized');
  const editable = !locked && can('sales.record');

  // Load server state on first open, or when the record is finalized / reopened.
  // Our own saves do not reload the rows, so typing is never interrupted.
  useEffect(() => {
    if (!data) return;
    const key = `${data.sale.id}:${data.sale.status}:${data.sale.correction_count}`;
    if (loadedKey.current === key || dirty) return;
    loadedKey.current = key;
    setDate(data.sale.sale_date);
    setActualMoney(data.sale.actual_money === null ? '' : num(data.sale.actual_money));
    setRemarks(data.sale.remarks ?? '');
    setLines(data.items.length ? fromItems(data.items, consigneeNames) : [newLine()]);
    loadedVersion.current = data.sale.version;
  }, [data, dirty, consigneeNames]);

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

  /** Edit a row. Unsold is not stored here: it is always Total − Sold. */
  const edit = (key: string, patch: Partial<Line>) => {
    touch();
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // SHARE follows SOLD (workbook: =IF(F="","",F)) unless edited by hand
        if (!next.shareTouched) next.share_quantity = next.sold_quantity;
        return next;
      }),
    );
  };
  const pickItem = (key: string, item: InventoryItem) =>
    edit(key, {
      inventory_item_id: item.id,
      item_name: item.name,
      itemManual: false,
      unit_price: num(item.selling_price),
      consignee: item.is_consigned ? item.consignee_name ?? '' : lines.find((l) => l.key === key)?.consignee || item.default_consignee || '',
      consigneeManual: false,
      is_canteen_stock: !item.is_consigned,
      cost_price: item.is_consigned && toNumber(item.unit_cost) > 0 ? num(item.unit_cost) : '',
    });

  const addRow = () => {
    setLines((ls) => [...ls, newLine()]);
    touch();
  };

  /** Append lines from History, filling the trailing blank row first. */
  const useHistory = (hist: HistoryLine[], { withQuantities }: { withQuantities: boolean }) => {
    const already = new Set(lines.filter((l) => l.item_name.trim()).map((l) => `${l.item_name.trim().toLowerCase()}|${l.consignee.trim().toLowerCase()}`));
    const fresh = hist.filter((h) => !already.has(`${h.item_name.trim().toLowerCase()}|${h.consignee.trim().toLowerCase()}`));
    const skipped = hist.length - fresh.length;
    const added: Line[] = fresh.map((h) => {
      const inv = h.inventory_item_id ? invById.get(h.inventory_item_id) : undefined;
      const linked = Boolean(inv?.is_active);
      const total = withQuantities ? String(h.total_quantity) : '';
      return {
        ...newLine(),
        inventory_item_id: linked ? inv!.id : null,
        item_name: h.item_name,
        itemManual: !linked,
        consignee: h.consignee,
        consigneeManual: Boolean(h.consignee) && !consigneeNames.has(h.consignee.trim().toLowerCase()),
        unit_price: String(h.unit_price),
        // cost comes from the product record (the database uses the same value)
        cost_price: linked && inv!.is_consigned && toNumber(inv!.unit_cost) > 0 ? num(inv!.unit_cost) : '',
        is_canteen_stock: linked ? !inv!.is_consigned : false,
        total_quantity: total,
      };
    });
    setLines((ls) => [...ls.filter((l) => l.item_name.trim() || l.total_quantity || l.sold_quantity), ...added]);
    touch();
    setTab('sheet');
    toast.success(`${added.length} item${added.length === 1 ? '' : 's'} added from history.${skipped ? ` ${skipped} already on the sheet.` : ''} Enter today's quantities.`);
  };

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
  const meaningful = lines.filter((l) => l.item_name.trim() || l.total_quantity || l.sold_quantity);
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
  const lineErrors = lines.map((l, i) => {
    if (!meaningful.includes(l)) return null;
    if (!l.item_name.trim()) return 'Item name is required.';
    if (l.unit_price === '') return 'Selling price is required.';
    if (!l.is_canteen_stock && l.cost_price !== '' && Number(l.cost_price) > n(l.unit_price)) return `Price is below this product's cost price (₱${l.cost_price}). Check the price or the cost in Products & Consignees.`;
    return calcLine(numericLines[i]).error;
  });
  const stockWarnings = lines.map((l) => {
    if (!l.inventory_item_id || locked) return null;
    const it = invById.get(l.inventory_item_id);
    if (!it || it.is_consigned) return null;
    return n(l.sold_quantity) > toNumber(it.quantity_on_hand) ? `Only ${qty(it.quantity_on_hand)} ${it.unit} in stock` : null;
  });
  const hasErrors = lineErrors.some(Boolean) || (actualMoney !== '' && Number(actualMoney) < 0) || date > todayPH();
  // started rows with inputs still empty (amber cells)
  const emptyInputs = meaningful.reduce(
    (a, l) =>
      a +
      [l.item_name.trim(), l.unit_price, l.total_quantity, l.sold_quantity].filter((v) => v === '').length,
    0,
  );
  const missingCost = meaningful.filter((l) => !l.is_canteen_stock && l.cost_price === '').length;

  async function save(opts: { auto?: boolean } = {}): Promise<string | null> {
    if (hasErrors) {
      if (opts.auto) setSaveState({ kind: 'error', message: 'Not saved — fix the rows marked in red' });
      else toast.error('Fix the rows marked in red before saving.');
      return null;
    }
    if (inFlight.current) return null;
    inFlight.current = true;
    const startRev = rev.current;
    if (!opts.auto) setBusy('save');
    setSaveState({ kind: 'saving' });
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
      const res = await rpc<{ id: string; version: number; new_products?: number; new_consignees?: number }>('save_daily_sale', {
        p_id: id ?? null,
        p_sale_date: date,
        p_actual_money: actualMoney === '' ? null : Number(actualMoney),
        p_remarks: remarks,
        p_lines: payload,
        p_expected_version: isNew ? null : loadedVersion.current,
      });
      loadedVersion.current = res.version;
      // changes typed while saving stay dirty and are saved next
      if (rev.current === startRev) setDirty(false);
      else setKick((k) => k + 1); // edits made during the save are saved next
      if (isNew) {
        loadedKey.current = `${res.id}:draft:0`;
        setRecordId(res.id);
        window.history.replaceState(window.history.state, '', `/daily-sales/${res.id}`);
      }
      setSaveState({ kind: 'saved', at: new Date() });
      await invalidate([keys.dailySales, keys.alerts, keys.ledger, keys.inventory, keys.consignees]);
      const added = [
        res.new_products ? `${res.new_products} new product${res.new_products === 1 ? '' : 's'}` : '',
        res.new_consignees ? `${res.new_consignees} new consignee${res.new_consignees === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      if (!opts.auto) toast.success(added.length ? `Draft saved. ${added.join(' and ')} added to the lists.` : 'Draft saved.');
      else if (added.length) toast.success(`${added.join(' and ')} added to the lists.`);
      return res.id;
    } catch (e) {
      const msg = (e as Error).message;
      setSaveState({ kind: 'error', message: msg });
      // another user changed this record: stop auto-saving to avoid overwriting
      if (/changed by another user/i.test(msg)) setAutoBlocked(true);
      if (!opts.auto) toast.error(msg);
      return null;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  // Auto-save ~1.5 s after the last change
  useEffect(() => {
    if (!editable || !dirty || autoBlocked) return;
    if (isNew && meaningful.length === 0 && !actualMoney && !remarks.trim()) return;
    const t = setTimeout(() => void save({ auto: true }), 1500);
    return () => clearTimeout(t);
  }, [lines, actualMoney, remarks, date, dirty, editable, autoBlocked, kick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter in a cell adds a row below (or moves to the next blank row)
  const onSheetKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || !editable) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    const row = Number(target.closest('tr')?.dataset.row);
    if (Number.isNaN(row)) return;
    e.preventDefault();
    const next = lines[row + 1];
    const blank = (l?: Line) => Boolean(l) && !l!.item_name.trim() && !l!.total_quantity && !l!.sold_quantity;
    focusRow.current = row + 1;
    if (blank(next)) {
      setLines((ls) => [...ls]); // re-render to run the focus effect
    } else {
      setLines((ls) => [...ls.slice(0, row + 1), newLine(), ...ls.slice(row + 1)]);
    }
  };
  useEffect(() => {
    if (focusRow.current === null) return;
    const r = focusRow.current;
    focusRow.current = null;
    (document.querySelector(`tr[data-row="${r}"] input`) as HTMLInputElement | null)?.focus();
  }, [lines]);

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
      toast.success('Daily sales finalized.');
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

  // Typed (not yet saved) products/consignees appear in the lists right away;
  // the database adds them to the product / consignee lists when the sheet is saved.
  const pendingItems = useMemo(() => {
    const seen = new Set(inventory.map((i) => `${i.name.trim().toLowerCase()}|${(i.consignee_name ?? '').trim().toLowerCase()}`));
    const out = new Map<string, Line>();
    lines.forEach((l) => {
      if (l.inventory_item_id || !l.item_name.trim()) return;
      const k = `${l.item_name.trim().toLowerCase()}|${l.consignee.trim().toLowerCase()}`;
      if (!seen.has(k) && !out.has(k)) out.set(k, l);
    });
    return out;
  }, [lines, inventory]);
  const itemOptions: ComboOption[] = useMemo(
    () => [
      ...[...pendingItems.entries()].map(([k, l]) => ({
        id: `new:${k}`,
        label: l.item_name.trim(),
        sub: `New${l.consignee.trim() ? ` · ${l.consignee.trim()}` : ''} · saved to the list when you save`,
        right: l.unit_price ? peso(l.unit_price) : undefined,
        keywords: l.consignee,
      })),
      ...inventory
        .filter((i) => i.is_active)
        .map((i) => ({
          id: i.id,
          label: i.name,
          sub: `${i.item_code} · ${i.is_consigned ? `Consigned · ${i.consignee_name ?? ''}` : `${qty(i.quantity_on_hand)} ${i.unit} on hand`}`,
          right: peso(i.selling_price),
          keywords: `${i.item_code} ${i.consignee_name ?? ''}`,
        })),
    ],
    [inventory, pendingItems],
  );
  const consigneeOptions: ComboOption[] = useMemo(() => {
    const listed = consignees.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name, sub: c.contact_number ?? undefined }));
    const known = new Set(consignees.map((c) => c.name.trim().toLowerCase()));
    const typed = [...new Set(lines.filter((l) => !l.is_canteen_stock && l.consignee.trim()).map((l) => l.consignee.trim()))]
      .filter((name) => !known.has(name.toLowerCase()))
      .map((name) => ({ id: `new:${name.toLowerCase()}`, label: name, sub: 'New · saved to the list when you save' }));
    return [...typed, ...listed];
  }, [consignees, lines]);

  const syName = schoolYears.find((y) => date >= y.start_date && date <= y.end_date)?.name;
  const report = (): OfficialReport => ({
    title: 'Daily Canteen Sales',
    period: formatDate(date, 'long'),
    schoolYear: syName,
    filename: `Sales-${date}`,
    sheetName: `Sales-${date}`,
    orientation: 'landscape',
    columns: [
      { key: 'no', header: 'No.', width: 6 },
      { key: 'item', header: 'Item', width: 26 },
      { key: 'consignee', header: 'Consignee', width: 16 },
      { key: 'price', header: 'Price per Piece', format: 'peso', width: 12 },
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
          price: n(l.unit_price),
          total: n(l.total_quantity),
          sold: n(l.sold_quantity),
          unsold: c.unsoldQuantity,
          amount: c.salesAmount,
          canteen_share: money[i].canteenShare,
          remit: l.is_canteen_stock ? null : money[i].remit,
        };
      }),
    totals: { item: 'TOTAL', total: totals.totalQuantity, sold: totals.unitsSold, unsold: totals.unsoldUnits, amount: totals.salesAmount, canteen_share: shareTotal, remit: remitTotal },
    sections: byConsignee.length
      ? [
          {
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
          },
        ]
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

  // spreadsheet input box; amber while a started row still needs the value
  const inputCell = (needs: boolean) =>
    cn(
      'h-9 w-full min-w-[78px] rounded-lg border border-surface-border bg-white px-2 text-right text-sm tabular shadow-[inset_0_1px_1px_rgba(16,40,24,0.04)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:shadow-none',
      needs && needsInputClass,
    );
  const calcCell = 'bg-surface-page/70 px-3 py-2.5 text-right tabular';

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
              {editable && <SaveStatus state={saveState} dirty={dirty} blocked={autoBlocked} />}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportMenu report={report} disabled={meaningful.length === 0} allow={can('sales.record') || can('reports.export')} label="Export" />
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
            {sale!.inventory_posted ? ' Sold quantities of canteen stock were deducted from inventory.' : ''} Corrections require an authorized user to reopen the record; every change is kept in the audit log.
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

        {/* Record information */}
        <Card>
          <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <div className="text-xs text-ink-muted">School</div>
              <div className="text-sm font-semibold">{settings?.school_name ?? 'QUIOT NATIONAL HIGH SCHOOL'}</div>
              <div className="text-xs text-ink-muted">School ID: {settings?.school_id_no ?? '312515'}</div>
            </div>
            <Field label="Date" required error={date > todayPH() ? 'Date cannot be in the future.' : null}>
              <Input type="date" value={date} max={todayPH()} disabled={!editable} onChange={(e) => { setDate(e.target.value); touch(); }} />
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
              <Input type="number" min={0} step="0.01" prefix="₱" value={actualMoney} disabled={!editable} onChange={(e) => { setActualMoney(e.target.value); touch(); }} />
            </Field>
          </CardBody>
        </Card>

        {/* Sheet / History */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'sheet' | 'history')}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="sheet" icon={<Sheet />}>
                Today's sheet
              </TabsTrigger>
              <TabsTrigger value="history" icon={<History />}>
                History
              </TabsTrigger>
            </TabsList>
            {tab === 'sheet' && editable && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3.5 w-5 rounded border border-surface-border bg-white" /> enter data
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3.5 w-5 rounded border border-gold-500 bg-gold-50" /> still empty
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3.5 w-5 rounded bg-surface-sunken" /> calculated
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <kbd className="rounded border border-surface-border bg-white px-1 text-[10px] font-semibold">Enter</kbd> new row
                </span>
              </div>
            )}
          </div>

          <TabsContent value="history">
            <Card>
              <CardHeader
                title="Reuse previous entries"
                description="Pick a previous day and reuse its items, consignees and prices — or choose from every item used recently. Quantities are left for you to enter unless you tick “Also copy total quantity”."
                icon={<History />}
              />
              {editable ? (
                <HistoryPanel beforeDate={date} onUse={useHistory} />
              ) : (
                <CardBody className="text-sm text-ink-muted">This record is locked. Reopen it to add items.</CardBody>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="sheet">
            <Card>
              <CardHeader
                title="Daily sales sheet"
                description={`Sales = Sold × Price per piece · Unsold = Total − Sold · Canteen share = (Price − product cost price) × Sold, or ₱${shareRate.toFixed(2)} × Sold when the product has no cost price · Remit = Sales − Canteen share`}
                actions={
                  editable && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setTab('history')}>
                        <History /> From history
                      </Button>
                      <Button size="sm" onClick={addRow}>
                        <Plus /> Add item
                      </Button>
                    </>
                  )
                }
              />
              {editable && emptyInputs > 0 && (
                <div className="border-b border-surface-border bg-gold-50/60 px-5 py-2 text-xs text-gold-600">
                  {emptyInputs} highlighted cell{emptyInputs === 1 ? '' : 's'} still need{emptyInputs === 1 ? 's' : ''} a value.
                </div>
              )}
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[1320px] border-collapse text-sm">
                  <thead className="bg-surface-page/80">
                    <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                      <th rowSpan={2} className="w-10 border-b border-surface-border px-3 py-2 text-left">No.</th>
                      <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-left">Product</th>
                      <th rowSpan={2} className="border-b border-surface-border px-2 py-2 text-left">Consignee</th>
                      <th rowSpan={2} className="border-b border-l border-surface-border px-2 py-2 text-right">Price per piece</th>
                      <th colSpan={3} className="border-b border-l border-surface-border px-2 pt-2 text-center">Quantity</th>
                      <th rowSpan={2} className="border-b border-l border-surface-border px-2 py-2 text-right">Sales</th>
                      <th rowSpan={2} className="border-b border-surface-border bg-brand-50/60 px-2 py-2 text-right text-brand-700">Canteen share</th>
                      <th rowSpan={2} className="border-b border-surface-border bg-gold-50/70 px-2 py-2 text-right text-gold-600">Remit to consignee</th>
                      <th rowSpan={2} className="border-b border-l border-surface-border px-2 py-2 text-right" title="Workbook SHARE column (quantity)">
                        Share qty
                      </th>
                      <th rowSpan={2} className="w-20 border-b border-surface-border" />
                    </tr>
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                      <th className="border-b border-l border-surface-border px-2 pb-1.5 text-right">Total</th>
                      <th className="border-b border-surface-border px-2 pb-1.5 text-right">Sold</th>
                      <th className="border-b border-surface-border px-2 pb-1.5 text-right" title="Total − Sold">Unsold</th>
                    </tr>
                  </thead>
                  <tbody onKeyDown={onSheetKeyDown}>
                    {lines.map((l, i) => {
                      const c = calcLine(numericLines[i]);
                      const err = lineErrors[i];
                      const warn = stockWarnings[i];
                      // a started row needs product, price, total and sold
                      const started = meaningful.includes(l) && editable;
                      const need = (v: string) => started && v.trim() === '';
                      return (
                        <tr key={l.key} data-row={i} className={cn('border-b border-surface-border align-top', err && 'bg-danger-50/50')}>
                          <td className="px-3 py-2.5 text-xs tabular text-ink-muted">{i + 1}</td>
                          <td className="px-1 py-1">
                            <SheetCombobox
                              ariaLabel={`Product row ${i + 1}`}
                              value={l.item_name}
                              options={itemOptions}
                              manual={l.itemManual}
                              linked={Boolean(l.inventory_item_id)}
                              disabled={!editable}
                              needsInput={need(l.item_name)}
                              placeholder="Choose or type a product"
                              manualLabel="Type product manually"
                              emptyText="No product with that name — use “Type product manually”."
                              onText={(t) => edit(l.key, { item_name: t, inventory_item_id: null, is_canteen_stock: false })}
                              onPick={(o) => {
                                const it = invById.get(o.id);
                                if (it) return pickItem(l.key, it);
                                const src = pendingItems.get(o.id.slice(4));
                                if (src)
                                  edit(l.key, {
                                    item_name: src.item_name.trim(),
                                    itemManual: true,
                                    inventory_item_id: null,
                                    is_canteen_stock: false,
                                    consignee: src.consignee,
                                    consigneeManual: src.consigneeManual,
                                    unit_price: src.unit_price,
                                    cost_price: src.cost_price,
                                  });
                              }}
                              onManualChange={(m) => edit(l.key, m ? { itemManual: true, inventory_item_id: null, is_canteen_stock: false } : { itemManual: false })}
                              onCreate={can('inventory.manage') ? (name) => setCreateFor({ key: l.key, name }) : undefined}
                              createLabel={(t) => `Open the full product form for “${t}”`}
                            />
                            {(err || warn) && <div className={cn('px-2 pb-1 pt-0.5 text-[11px]', err ? 'text-danger-600' : 'text-warn-700')}>{err ?? warn}</div>}
                          </td>
                          <td className="px-1 py-1">
                            {l.is_canteen_stock ? (
                              <div className="px-2 py-2 text-xs font-medium text-brand-700">Canteen stock</div>
                            ) : (
                              <SheetCombobox
                                ariaLabel={`Consignee row ${i + 1}`}
                                value={l.consignee}
                                options={consigneeOptions}
                                manual={l.consigneeManual}
                                disabled={!editable}
                                placeholder="Choose or type"
                                manualLabel="Type consignee manually"
                                emptyText="Not in the consignee list — use “Type consignee manually”."
                                onText={(t) => edit(l.key, { consignee: t })}
                                onPick={(o) => edit(l.key, { consignee: o.label, consigneeManual: false })}
                                onManualChange={(m) => edit(l.key, { consigneeManual: m })}
                                needsInput={started && !l.inventory_item_id && !l.consignee.trim()}
                              />
                            )}
                            {started && !l.inventory_item_id && !l.is_canteen_stock && !l.consignee.trim() && (
                              <div className="px-2 pt-0.5 text-[11px] text-gold-600">Needed to save this new product to the list</div>
                            )}
                          </td>
                          <td className="border-l border-surface-border px-1 py-1">
                            <input type="number" min={0} step="0.01" value={l.unit_price} disabled={!editable} onChange={(e) => edit(l.key, { unit_price: e.target.value })} className={inputCell(need(l.unit_price))} aria-required={started || undefined} title={need(l.unit_price) ? 'Required — enter the price per piece' : undefined} aria-label={`Price per piece row ${i + 1}`} />
                          </td>
                          <td className="border-l border-surface-border px-1 py-1">
                            <input type="number" min={0} step="any" value={l.total_quantity} disabled={!editable} onChange={(e) => edit(l.key, { total_quantity: e.target.value })} className={inputCell(need(l.total_quantity))} aria-required={started || undefined} title={need(l.total_quantity) ? 'Required — enter the quantity brought in' : undefined} aria-label={`Total quantity row ${i + 1}`} />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={l.sold_quantity}
                              disabled={!editable}
                              onChange={(e) => edit(l.key, { sold_quantity: e.target.value })}
                              className={cn(inputCell(need(l.sold_quantity)), 'font-semibold', c.error && 'text-danger-600')}
                              aria-required={started || undefined}
                              title={need(l.sold_quantity) ? 'Required — enter the quantity sold (0 if none)' : undefined}
                              aria-label={`Sold quantity row ${i + 1}`}
                            />
                          </td>
                          <td
                            className={cn(calcCell, c.unsoldQuantity < 0 && 'text-danger-600')}
                            title="Calculated as Total − Sold"
                            aria-label={`Unsold quantity row ${i + 1} (calculated)`}
                          >
                            {l.total_quantity === '' || l.sold_quantity === '' ? <span className="text-ink-soft">—</span> : qty(c.unsoldQuantity)}
                          </td>
                          <td className={cn(calcCell, 'border-l border-surface-border font-medium')}>{peso(c.salesAmount)}</td>
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
                              className={cn(inputCell(false), 'min-w-[64px] text-ink-muted', l.shareTouched && 'text-gold-600')}
                              aria-label={`Share quantity row ${i + 1}`}
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
                                    touch();
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
                                    touch();
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
                      <td colSpan={4} className="px-3 py-3 text-right text-xs uppercase tracking-wider text-ink-muted">
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
                <div className="flex flex-wrap items-center gap-2 border-t border-surface-border px-5 py-3">
                  <Button variant="ghost" size="sm" onClick={addRow}>
                    <Plus /> Add row
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setTab('history')}>
                    <History /> Add from history
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        {/* Remittance + remarks */}
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
                      <td className="px-4 py-2.5" colSpan={3}>
                        Total
                      </td>
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
              <Textarea value={remarks} disabled={!editable} onChange={(e) => { setRemarks(e.target.value); touch(); }} placeholder="Notes for this day (optional)" rows={4} />
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
              {meaningful.length} items · {qty(totals.unitsSold)} pcs sold · {peso(totals.salesAmount)} collected · {peso(remitTotal)} to remit.
            </p>
            {missingCost > 0 && (
              <p className="text-gold-600">
                {missingCost} consigned item{missingCost === 1 ? ' has' : 's have'} no cost price in Products & Consignees — the canteen share for {missingCost === 1 ? 'it' : 'them'} will be ₱{shareRate.toFixed(2)} per piece.
              </p>
            )}
            <p>Canteen-stock quantities sold will be deducted from inventory and the record will be locked. Corrections afterwards require an authorized reopen.</p>
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
          if (it && key) pickItem(key, it as InventoryItem);
        }}
      />
      {busy === 'save' && <span className="sr-only">Saving…</span>}
    </>
  );
}

function SaveStatus({ state, dirty, blocked }: { state: { kind: 'idle' | 'saving' | 'saved' | 'error'; at?: Date; message?: string }; dirty: boolean; blocked: boolean }) {
  const time = (d?: Date) => (d ? new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(d) : '');
  if (state.kind === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (state.kind === 'error' || blocked)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger-600" role="alert">
        <CloudOff className="size-3.5" /> {blocked ? 'Changed by another user — reload the page to continue' : state.message}
      </span>
    );
  if (dirty)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gold-600">
        <Cloud className="size-3.5" /> Unsaved changes — saving automatically…
      </span>
    );
  if (state.kind === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-brand-700">
        <CloudCheck className="size-3.5" /> All changes saved · {time(state.at)}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <CloudCheck className="size-3.5" /> Auto-save on
    </span>
  );
}
