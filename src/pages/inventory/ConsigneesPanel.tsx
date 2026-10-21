import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { supabase, unwrap } from '@/lib/supabase';
import { keys, useAction, useConsignees, useInventory } from '@/lib/queries';
import { peso } from '@/lib/utils';
import type { Consignee } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Switch, Textarea } from '@/components/ui/form';
import { EmptyState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FilterBar, FilterField } from '@/components/shared';

/** Consignees and the products they supply to the canteen. */
export function ConsigneesPanel({ onAddProduct }: { onAddProduct: (consigneeId: string) => void }) {
  const { can } = useAuth();
  const { data: consignees = [], isLoading } = useConsignees();
  const { data: items = [] } = useInventory(true);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Consignee | 'new' | null>(null);
  const toggle = useAction(
    async (c: Consignee) => unwrap(await supabase.from('consignees').update({ is_active: !c.is_active }).eq('id', c.id).select('id').single()),
    { invalidate: [keys.consignees, keys.inventory] },
  );

  const productsBy = useMemo(() => {
    const m = new Map<string, typeof items>();
    items.filter((i) => i.is_consigned && i.consignee_id).forEach((i) => m.set(i.consignee_id!, [...(m.get(i.consignee_id!) ?? []), i]));
    return m;
  }, [items]);
  const rows = consignees.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Card>
      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input className="pl-9" placeholder="Consignee name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </FilterField>
        {can('inventory.manage') && (
          <div className="ml-auto self-end">
            <Button onClick={() => setEdit('new')}>
              <Plus /> Add consignee
            </Button>
          </div>
        )}
      </FilterBar>
      {isLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UserRound />}
          title={consignees.length === 0 ? 'No consignees yet' : 'No consignees match'}
          description="Consignees are the people who bring goods for the canteen to sell (e.g. Judy Ann, Jean, Emily). You can also load them from the workbook under Settings → Excel import."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Consignee</TH>
              <TH>Contact</TH>
              <TH>Products (selling price)</TH>
              <TH align="right">Active</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {rows.map((c) => {
              const prods = (productsBy.get(c.id) ?? []).filter((p) => p.is_active);
              return (
                <TR key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                  <TD className="font-medium">
                    {c.name}
                    {c.remarks && <div className="text-xs font-normal text-ink-muted">{c.remarks}</div>}
                  </TD>
                  <TD className="text-ink-muted">{c.contact_number ?? '—'}</TD>
                  <TD className="max-w-[460px]">
                    <div className="flex flex-wrap gap-1.5">
                      {prods.length === 0 ? (
                        <span className="text-xs text-ink-muted">No products yet</span>
                      ) : (
                        prods.map((p) => (
                          <Badge key={p.id} tone="blue">
                            {p.name} · {peso(p.selling_price)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD align="right">
                    <Switch checked={c.is_active} disabled={!can('inventory.manage')} onChange={() => toggle.mutate(c)} label={`${c.name} active`} />
                  </TD>
                  <TD align="right">
                    {can('inventory.manage') && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onAddProduct(c.id)}>
                          <Plus /> Product
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEdit(c)}>
                          <Pencil />
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
      <ConsigneeDialog consignee={edit} onClose={() => setEdit(null)} />
    </Card>
  );
}

function ConsigneeDialog({ consignee, onClose }: { consignee: Consignee | 'new' | null; onClose: () => void }) {
  const isNew = consignee === 'new';
  const current = consignee && consignee !== 'new' ? consignee : null;
  const [f, setF] = useState({ name: '', contact_number: '', address: '', remarks: '' });
  const [key, setKey] = useState<Consignee | 'new' | null>(null);
  if (consignee !== key) {
    setKey(consignee);
    setF({ name: current?.name ?? '', contact_number: current?.contact_number ?? '', address: current?.address ?? '', remarks: current?.remarks ?? '' });
  }
  const save = useAction(
    async () => {
      const payload = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
      return isNew
        ? unwrap(await supabase.from('consignees').insert(payload).select('id').single())
        : unwrap(await supabase.from('consignees').update(payload).eq('id', current!.id).select('id').single());
    },
    { success: isNew ? 'Consignee added.' : 'Consignee updated.', invalidate: [keys.consignees, keys.inventory], onSuccess: onClose },
  );
  return (
    <Dialog
      open={Boolean(consignee)}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Add consignee' : `Edit ${current?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="e.g. Judy Ann" />
        </Field>
        <Field label="Contact number">
          <Input value={f.contact_number} onChange={(e) => setF({ ...f, contact_number: e.target.value })} />
        </Field>
        <Field label="Address">
          <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Remarks" className="sm:col-span-2">
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
