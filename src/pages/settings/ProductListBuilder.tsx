import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, PackagePlus } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { keys, useAction, useCategories, useInventory } from '@/lib/queries';
import type { DerivedProduct } from '@/lib/import/workbook';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/feedback';
import { Select, needsInputClass } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ui/dialog';

interface Row extends DerivedProduct {
  include: boolean;
  consigned: boolean;
  cost: string;
  price: string;
  editName: string;
  editConsignee: string;
  category: string;
}

const cell =
  'h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm hover:border-surface-border focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20';

/** Review the products found in the DAILY SALES sheet, then create them in one step. */
export function ProductListBuilder({ products }: { products: DerivedProduct[] }) {
  const { data: existing = [] } = useInventory(true);
  const { data: categories = [] } = useCategories();
  const exists = useMemo(() => {
    const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const set = new Set(existing.map((i) => `${norm(i.name)}|${norm(i.consignee_name ?? i.default_consignee)}`));
    return (p: { editName: string; editConsignee: string }) => set.has(`${norm(p.editName)}|${norm(p.editConsignee)}`);
  }, [existing]);
  const [rows, setRows] = useState<Row[]>(() =>
    products.map((p) => ({
      ...p,
      include: !p.possibleDuplicateOf,
      consigned: Boolean(p.consignee),
      cost: '',
      price: String(p.selling_price),
      editName: p.name,
      editConsignee: p.consignee ?? '',
      category: '',
    })),
  );
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number; new_consignees: number } | null>(null);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.include && !exists(r));

  const create = useAction(
    () =>
      rpc<{ created: number; skipped: number; new_consignees: number }>('import_products', {
        p_rows: selected.map((r) => ({
          name: r.editName.trim(),
          consignee: r.editConsignee.trim() || null,
          selling_price: Number(r.price || 0),
          unit_cost: r.cost === '' ? 0 : Number(r.cost),
          is_consigned: r.consigned && Boolean(r.editConsignee.trim()),
          category: r.category || null,
        })),
      }),
    {
      invalidate: [keys.inventory, keys.consignees, keys.alerts, keys.reports],
      onSuccess: (r) => {
        setDone(r);
        setConfirm(false);
      },
    },
  );

  if (done) {
    return (
      <Callout
        tone="info"
        title="Product list created"
        action={
          <Button asChild size="sm">
            <Link to="/inventory">Open Products & Consignees</Link>
          </Button>
        }
      >
        {done.created} products and {done.new_consignees} consignees were added
        {done.skipped ? `; ${done.skipped} already existed and were skipped` : ''}. Add cost prices and categories anytime from Products & Consignees.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <Callout tone="info" title={`${products.length} products found in the DAILY SALES sheet`}>
        Each item and consignee appears once, with its most recent selling price. Spelling variations were merged. Untick anything you don't want, fix names or prices, and add cost prices if you know them. Items with a consignee are marked <b>consigned</b> (not stock-tracked); switch canteen-owned goods to <b>Canteen stock</b>.
      </Callout>
      <div className="overflow-hidden rounded-xl border border-surface-border">
        <div className="scrollbar-thin max-h-[560px] overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-page text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="accent-brand-600"
                    checked={rows.every((r) => r.include || exists(r))}
                    onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))}
                  />
                </th>
                <th className="px-2 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">Consignee</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="w-28 px-2 py-2 text-right">Selling ₱</th>
                <th className="w-28 px-2 py-2 text-right">Cost ₱</th>
                <th className="px-2 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const already = exists(r);
                return (
                  <tr key={r.key} className={cn('border-t border-surface-border', (!r.include || already) && 'bg-surface-page/60 text-ink-muted')}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" className="accent-brand-600" aria-label={`Include ${r.editName}`} disabled={already} checked={r.include && !already} onChange={(e) => set(r.key, { include: e.target.checked })} />
                    </td>
                    <td className="px-1 py-1">
                      <input className={cn(cell, r.include && !already && !r.editName.trim() && needsInputClass)} aria-required value={r.editName} onChange={(e) => set(r.key, { editName: e.target.value })} aria-label="Item name" />
                    </td>
                    <td className="px-1 py-1">
                      <input className={cell} value={r.editConsignee} onChange={(e) => set(r.key, { editConsignee: e.target.value })} aria-label="Consignee" />
                    </td>
                    <td className="px-1 py-1">
                      <Select className="h-8 text-[13px]" value={r.consigned ? 'c' : 's'} onChange={(e) => set(r.key, { consigned: e.target.value === 'c' })}>
                        <option value="c">Consigned</option>
                        <option value="s">Canteen stock</option>
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      <Select className="h-8 text-[13px]" value={r.category} onChange={(e) => set(r.key, { category: e.target.value })}>
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" min={0} step="0.01" className={cn(cell, 'text-right tabular', r.include && !already && r.price === '' && needsInputClass)} aria-required value={r.price} onChange={(e) => set(r.key, { price: e.target.value })} aria-label="Selling price" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" min={0} step="0.01" className={cn(cell, 'text-right tabular')} value={r.cost} placeholder="—" onChange={(e) => set(r.key, { cost: e.target.value })} aria-label="Cost price" />
                    </td>
                    <td className="px-2 py-1 text-xs text-ink-muted">
                      {already ? (
                        <span className="inline-flex items-center gap-1 text-brand-700">
                          <CheckCircle2 className="size-3.5" /> Already in inventory
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          {r.possibleDuplicateOf && (
                            <div className="inline-flex items-center gap-1 text-warn-700">
                              <AlertTriangle className="size-3.5" /> Looks like “{r.possibleDuplicateOf}”
                            </div>
                          )}
                          {r.prices.length > 1 && <div>Prices seen: ₱{r.prices.join(', ₱')}</div>}
                          {r.spellings.length > 1 && <div>Also spelled: {r.spellings.filter((s) => s !== r.editName).join(' · ')}</div>}
                          <div>
                            {r.days} day{r.days === 1 ? '' : 's'}
                            {r.lastSeen ? ` · last ${formatDate(r.lastSeen, 'short')}` : ''}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-page p-4">
        <p className="text-sm text-ink-muted">
          {selected.length} products selected · {new Set(selected.map((r) => r.editConsignee.trim().toLowerCase()).filter(Boolean)).size} consignees
        </p>
        <Button onClick={() => setConfirm(true)} disabled={selected.length === 0 || selected.some((r) => !r.editName.trim() || !(Number(r.price) >= 0))}>
          <PackagePlus /> Create {selected.length} products
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Create ${selected.length} products?`}
        description="Missing consignees are created automatically. Products that already exist are skipped, so it is safe to run this again. Item codes are assigned automatically (CN-0001 …)."
        confirmLabel="Create products"
        loading={create.isPending}
        onConfirm={() => create.mutate(undefined)}
      />
    </div>
  );
}
