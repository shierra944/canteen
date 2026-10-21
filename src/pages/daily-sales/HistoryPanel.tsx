import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, History, ListPlus, Search } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { cn, formatDate, peso, qty, toNumber } from '@/lib/utils';
import type { DailySale, DailySaleItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/form';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/badge';

export interface HistoryLine {
  inventory_item_id: string | null;
  item_name: string;
  consignee: string;
  cost_price: number | null;
  unit_price: number;
  total_quantity: number;
  is_canteen_stock: boolean;
}

const toHistory = (i: DailySaleItem): HistoryLine => ({
  inventory_item_id: i.inventory_item_id,
  item_name: i.item_name_snapshot,
  consignee: i.consignee ?? '',
  cost_price: i.cost_price === null ? null : toNumber(i.cost_price),
  unit_price: toNumber(i.unit_price),
  total_quantity: toNumber(i.total_quantity),
  is_canteen_stock: i.is_canteen_stock,
});

/**
 * Previous days' entries, reusable for the current sheet: a whole day's list
 * or selected rows (item, consignee, cost and selling price).
 */
export function HistoryPanel({
  beforeDate,
  onUse,
}: {
  beforeDate: string;
  onUse: (lines: HistoryLine[], opts: { withQuantities: boolean }) => void;
}) {
  const [mode, setMode] = useState<'day' | 'items'>('day');
  const [dayId, setDayId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withQty, setWithQty] = useState(false);
  const [search, setSearch] = useState('');

  const days = useQuery({
    queryKey: ['daily-sales', 'history-days', beforeDate],
    queryFn: async () =>
      unwrap(
        await supabase.from('v_daily_sales').select('id, sale_date, status, line_count, sales_amount, units_sold').lt('sale_date', beforeDate).order('sale_date', { ascending: false }).limit(30),
      ) as Pick<DailySale, 'id' | 'sale_date' | 'status' | 'line_count' | 'sales_amount' | 'units_sold'>[],
  });
  useEffect(() => {
    if (!dayId && days.data?.[0]) setDayId(days.data[0].id);
  }, [days.data, dayId]);

  const dayLines = useQuery({
    queryKey: ['daily-sales', 'history-lines', dayId],
    enabled: Boolean(dayId) && mode === 'day',
    queryFn: async () => unwrap(await supabase.from('v_daily_sale_lines').select('*').eq('daily_sale_id', dayId!).order('line_no')) as DailySaleItem[],
  });

  // every item + consignee used in the last 30 records, with its latest values
  const recent = useQuery({
    queryKey: ['daily-sales', 'history-recent', beforeDate, days.data?.length],
    enabled: mode === 'items' && Boolean(days.data?.length),
    queryFn: async () => {
      const ids = days.data!.map((d) => d.id);
      const rows = unwrap(await supabase.from('v_daily_sale_lines').select('*').in('daily_sale_id', ids)) as DailySaleItem[];
      const dateOf = new Map(days.data!.map((d) => [d.id, d.sale_date]));
      const map = new Map<string, { line: HistoryLine; last: string; days: number }>();
      for (const r of rows) {
        const k = `${r.item_name_snapshot.trim().toLowerCase()}|${(r.consignee ?? '').trim().toLowerCase()}`;
        const date = dateOf.get(r.daily_sale_id) ?? '';
        const cur = map.get(k);
        if (!cur) map.set(k, { line: toHistory(r), last: date, days: 1 });
        else {
          cur.days += 1;
          if (date > cur.last) Object.assign(cur, { line: toHistory(r), last: date });
        }
      }
      return [...map.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.days - a.days || a.line.item_name.localeCompare(b.line.item_name));
    },
  });

  // reset selection when switching source
  useEffect(() => setSelected(new Set()), [dayId, mode]);

  const term = search.trim().toLowerCase();
  const list = useMemo(() => {
    const src =
      mode === 'day'
        ? (dayLines.data ?? []).map((r) => ({ key: r.id, line: toHistory(r), info: null as string | null }))
        : (recent.data ?? []).map((r) => ({ key: r.key, line: r.line, info: `${r.days} day${r.days === 1 ? '' : 's'} · last ${formatDate(r.last, 'short')}` }));
    return src.filter((r) => !term || `${r.line.item_name} ${r.line.consignee}`.toLowerCase().includes(term));
  }, [mode, dayLines.data, recent.data, term]);

  const use = (keys: string[] | 'all') => {
    const chosen = keys === 'all' ? list : list.filter((r) => keys.includes(r.key));
    if (chosen.length === 0) return;
    onUse(chosen.map((r) => r.line), { withQuantities: withQty });
    setSelected(new Set());
  };

  if (days.isLoading) return <Skeleton className="m-5 h-64" />;
  if (!days.data?.length) {
    return <EmptyState icon={<History />} title="No earlier records yet" description="Once you save a day's sales, its items, consignees and prices appear here so you can reuse them the next day." />;
  }

  const loading = mode === 'day' ? dayLines.isLoading : recent.isLoading;
  return (
    <div className="grid gap-0 lg:grid-cols-[260px_1fr]">
      {/* Left: source */}
      <div className="border-b border-surface-border p-4 lg:border-b-0 lg:border-r">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-page p-1 text-xs font-medium">
          {(['day', 'items'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn('rounded-md px-2 py-1.5', mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-muted hover:text-ink')}>
              {m === 'day' ? 'By day' : 'All recent items'}
            </button>
          ))}
        </div>
        {mode === 'day' ? (
          <ul className="scrollbar-thin max-h-[420px] space-y-1 overflow-y-auto">
            {days.data.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => setDayId(d.id)}
                  className={cn('w-full rounded-lg px-3 py-2 text-left', dayId === d.id ? 'bg-brand-50 ring-1 ring-inset ring-brand-500/30' : 'hover:bg-surface-page')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <CalendarDays className="size-3.5 text-ink-muted" />
                      {formatDate(d.sale_date, 'medium')}
                    </span>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {d.line_count} items · {qty(d.units_sold)} sold · {peso(d.sales_amount)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-relaxed text-ink-muted">
            Every item and consignee used in the last {days.data.length} records, with the most recent cost and selling price. Most-used first.
          </p>
        )}
      </div>

      {/* Right: lines */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input className="h-9 pl-9" placeholder="Search item or consignee" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Checkbox checked={withQty} onChange={setWithQty} label="Also copy total quantity" />
          <Button size="sm" variant="secondary" disabled={selected.size === 0} onClick={() => use([...selected])}>
            <ListPlus /> Add {selected.size || ''} selected
          </Button>
          <Button size="sm" disabled={list.length === 0} onClick={() => use('all')}>
            <ListPlus /> Use all {list.length}
          </Button>
        </div>
        {loading ? (
          <Skeleton className="m-4 h-48" />
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">Nothing to show.</div>
        ) : (
          <div className="scrollbar-thin max-h-[420px] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-surface-page text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="w-10 px-4 py-2 text-left">
                    <input
                      type="checkbox"
                      className="accent-brand-600"
                      aria-label="Select all"
                      checked={selected.size > 0 && selected.size === list.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(list.map((r) => r.key)) : new Set())}
                    />
                  </th>
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-left">Consignee</th>
                  <th className="px-2 py-2 text-right">Cost</th>
                  <th className="px-2 py-2 text-right">Selling</th>
                  <th className="px-2 py-2 text-right">Total qty</th>
                  {mode === 'items' && <th className="px-4 py-2 text-left">Used</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.key}
                    className={cn('cursor-pointer border-t border-surface-border', selected.has(r.key) ? 'bg-brand-50/60' : 'hover:bg-surface-page')}
                    onClick={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(r.key)) n.delete(r.key);
                        else n.add(r.key);
                        return n;
                      })
                    }
                  >
                    <td className="px-4 py-2">
                      <input type="checkbox" className="accent-brand-600" readOnly checked={selected.has(r.key)} aria-label={`Select ${r.line.item_name}`} />
                    </td>
                    <td className="px-2 py-2 font-medium">{r.line.item_name}</td>
                    <td className="px-2 py-2 text-ink-muted">{r.line.is_canteen_stock ? 'Canteen stock' : r.line.consignee || '—'}</td>
                    <td className="px-2 py-2 text-right tabular">{r.line.cost_price === null ? '—' : peso(r.line.cost_price)}</td>
                    <td className="px-2 py-2 text-right tabular">{peso(r.line.unit_price)}</td>
                    <td className="px-2 py-2 text-right tabular text-ink-muted">{qty(r.line.total_quantity)}</td>
                    {mode === 'items' && <td className="px-4 py-2 text-xs text-ink-muted">{r.info}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
