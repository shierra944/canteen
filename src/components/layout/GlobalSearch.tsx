import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '@radix-ui/react-dialog';
import { Boxes, CornerDownLeft, Receipt, Search, ShoppingBasket } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';
import { cn, formatDate, peso } from '@/lib/utils';
import { NAV_ITEMS, canSee } from './nav';

interface Result {
  key: string;
  group: string;
  label: string;
  sub?: string;
  to: string;
  icon: typeof Boxes;
}

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const term = useDebounced(q.trim());
  const navigate = useNavigate();
  const { can } = useAuth();

  const { data: remote = [], isFetching } = useQuery({
    queryKey: ['global-search', term],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const safe = term.replace(/[,()%]/g, ' ');
      const [items, fin, sales] = await Promise.all([
        supabase.from('v_inventory_items').select('id, name, item_code, quantity_on_hand, unit').or(`name.ilike.%${safe}%,item_code.ilike.%${safe}%`).limit(6),
        can('reports.view') || can('finance.record')
          ? supabase.from('financial_transactions').select('id, description, transaction_date, amount, transaction_type').ilike('description', `%${safe}%`).order('transaction_date', { ascending: false }).limit(6)
          : Promise.resolve({ data: [] as never[] }),
        /^\d{4}-\d{2}(-\d{2})?$/.test(term) && (can('reports.view') || can('sales.record'))
          ? supabase.from('daily_sales').select('id, sale_date, status').like('sale_date', `${term}%`).limit(6)
          : Promise.resolve({ data: [] as never[] }),
      ]);
      const out: Result[] = [];
      (items.data ?? []).forEach((i: { id: string; name: string; item_code: string; quantity_on_hand: number; unit: string }) =>
        out.push({ key: 'i' + i.id, group: 'Products', label: i.name, sub: `${i.item_code} · ${Number(i.quantity_on_hand)} ${i.unit} on hand`, to: `/inventory/${i.id}`, icon: Boxes }),
      );
      (fin.data ?? []).forEach((f: { id: string; description: string; transaction_date: string; amount: number; transaction_type: string }) =>
        out.push({ key: 'f' + f.id, group: 'Expenses & other sales', label: f.description, sub: `${formatDate(f.transaction_date)} · ${f.transaction_type} · ${peso(f.amount)}`, to: `/finance?txn=${f.id}`, icon: Receipt }),
      );
      (sales.data ?? []).forEach((s: { id: string; sale_date: string; status: string }) =>
        out.push({ key: 's' + s.id, group: 'Daily sales', label: formatDate(s.sale_date, 'long'), sub: s.status, to: `/daily-sales/${s.id}`, icon: ShoppingBasket }),
      );
      return out;
    },
  });

  const results = useMemo(() => {
    const pages: Result[] = NAV_ITEMS.filter((n) => canSee(n, can))
      .filter((n) => !term || n.label.toLowerCase().includes(term.toLowerCase()))
      .map((n) => ({ key: 'p' + n.to, group: 'Pages', label: n.label, to: n.to, icon: n.icon }));
    return [...pages, ...(term.length >= 2 ? remote : [])];
  }, [term, remote, can]);

  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (r: Result) => {
    onOpenChange(false);
    navigate(r.to);
  };

  let lastGroup = '';
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[#0c1f13]/40 backdrop-blur-[2px] animate-fade-in" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-surface-border bg-white shadow-overlay animate-scale-in">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search inventory items, transactions, daily sales dates and pages.</D.Description>
          <div className="flex items-center gap-3 border-b border-surface-border px-4">
            <Search className="size-4 text-ink-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(results.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter' && results[active]) {
                  go(results[active]);
                }
              }}
              placeholder="Search items, expenses, or a date (2026-03-02)…"
              className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-soft"
            />
            {isFetching && <span className="text-xs text-ink-muted">Searching…</span>}
          </div>
          <div className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
            {results.length === 0 ? (
              <div className="py-10 text-center text-sm text-ink-muted">No matches.</div>
            ) : (
              results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <div key={r.key}>
                    {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{header}</div>}
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === active ? 'bg-brand-50' : 'hover:bg-surface-page')}
                    >
                      <r.icon className={cn('size-4 shrink-0', i === active ? 'text-brand-600' : 'text-ink-muted')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{r.label}</span>
                        {r.sub && <span className="block truncate text-xs text-ink-muted">{r.sub}</span>}
                      </span>
                      {i === active && <CornerDownLeft className="size-3.5 text-brand-600" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
