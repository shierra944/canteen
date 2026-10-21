import { useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase, unwrap } from '@/lib/supabase';
import { keys, useAction, useCategories, useSuppliers } from '@/lib/queries';
import type { Category, Supplier } from '@/lib/types';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/form';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';

export function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data = [] } = useCategories();
  const [name, setName] = useState('');
  const add = useAction(
    async () => unwrap(await supabase.from('inventory_categories').insert({ name: name.trim() }).select('id').single()),
    { success: 'Category added.', invalidate: [keys.categories], onSuccess: () => setName('') },
  );
  const toggle = useAction(
    async (c: Category) => unwrap(await supabase.from('inventory_categories').update({ is_active: !c.is_active }).eq('id', c.id).select('id').single()),
    { invalidate: [keys.categories] },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Inventory categories" description="Default categories: Food, Drinks, Supplies, Other.">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(undefined);
        }}
      >
        <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={add.isPending} disabled={!name.trim()}>
          <Plus /> Add
        </Button>
      </form>
      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH align="right">Active</TH>
          </tr>
        </THead>
        <tbody>
          {data.map((c) => (
            <TR key={c.id}>
              <TD>{c.name}</TD>
              <TD align="right">
                <Switch checked={c.is_active} onChange={() => toggle.mutate(c)} label={`${c.name} active`} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Dialog>
  );
}

export function SuppliersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data = [] } = useSuppliers();
  const empty = { name: '', contact_person: '', phone: '', email: '', address: '' };
  const [f, setF] = useState(empty);
  const add = useAction(
    async () =>
      unwrap(
        await supabase
          .from('suppliers')
          .insert(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])))
          .select('id')
          .single(),
      ),
    { success: 'Supplier added.', invalidate: [keys.suppliers], onSuccess: () => setF(empty) },
  );
  const toggle = useAction(
    async (s: Supplier) => unwrap(await supabase.from('suppliers').update({ is_active: !s.is_active }).eq('id', s.id).select('id').single()),
    { invalidate: [keys.suppliers] },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Suppliers" size="lg">
      <form
        className="mb-5 grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.name.trim()) add.mutate(undefined);
        }}
      >
        <Input placeholder="Supplier name *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="Contact person" value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} />
        <Input placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input placeholder="Address" className="sm:col-span-2" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" loading={add.isPending} disabled={!f.name.trim()}>
            <Plus /> Add supplier
          </Button>
        </div>
      </form>
      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Contact</TH>
            <TH>Phone</TH>
            <TH align="right">Active</TH>
          </tr>
        </THead>
        <tbody>
          {data.map((s) => (
            <TR key={s.id}>
              <TD className="font-medium">{s.name}</TD>
              <TD className="text-ink-muted">{s.contact_person ?? '—'}</TD>
              <TD className="text-ink-muted">{s.phone ?? '—'}</TD>
              <TD align="right">
                <Switch checked={s.is_active} onChange={() => toggle.mutate(s)} label={`${s.name} active`} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Dialog>
  );
}
