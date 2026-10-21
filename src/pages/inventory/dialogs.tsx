import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { keys, useAction, useCategories, useConsignees, useInventory, useSettings, useSuppliers } from '@/lib/queries';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { ADJUSTMENT_TYPES } from '@/lib/labels';
import { cn, peso, qty, round2, toNumber, todayPH, uuid } from '@/lib/utils';
import type { InventoryItem, InvTxnType } from '@/lib/types';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/feedback';

// ------------------------------------------------------------ item form
interface ItemForm {
  name: string;
  item_code: string;
  category_id: string;
  unit: string;
  initial_quantity: string;
  unit_cost: string;
  selling_price: string;
  reorder_level: string;
  supplier_id: string;
  expiration_date: string;
  default_consignee: string;
  description: string;
  is_consigned: boolean;
  consignee_id: string;
}

const UNITS = ['piece', 'pack', 'bottle', 'can', 'cup', 'serving', 'box', 'kilo', 'gram', 'liter', 'gallon', 'sachet', 'dozen'];

export function ItemDialog({
  open,
  onOpenChange,
  item,
  onSaved,
  initialName,
  initialConsigneeId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item?: InventoryItem | null;
  onSaved?: (id: string) => void;
  initialName?: string;
  initialConsigneeId?: string;
}) {
  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();
  const { data: consignees = [] } = useConsignees();
  const { data: settings } = useSettings();
  const editing = Boolean(item);
  const blank: ItemForm = useMemo(
    () => ({
      name: item?.name ?? initialName ?? '',
      item_code: item?.item_code ?? '',
      category_id: item?.category_id ?? '',
      unit: item?.unit ?? 'piece',
      initial_quantity: '0',
      unit_cost: item ? String(toNumber(item.unit_cost)) : '',
      selling_price: item ? String(toNumber(item.selling_price)) : '',
      reorder_level: item ? String(toNumber(item.reorder_level)) : String(toNumber(settings?.default_reorder_level ?? 10)),
      supplier_id: item?.supplier_id ?? '',
      expiration_date: item?.expiration_date ?? '',
      default_consignee: item?.default_consignee ?? '',
      description: item?.description ?? '',
      is_consigned: item ? item.is_consigned : Boolean(initialConsigneeId),
      consignee_id: item?.consignee_id ?? initialConsigneeId ?? '',
    }),
    [item, initialName, initialConsigneeId, settings],
  );
  const [f, setF] = useState<ItemForm>(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof ItemForm, string>>>({});
  useEffect(() => {
    if (open) {
      setF(blank);
      setErrors({});
    }
  }, [open, blank]);

  const set = (k: keyof ItemForm) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const expectedValue = round2(toNumber(f.initial_quantity) * toNumber(f.unit_cost));

  const save = useAction(
    async () => {
      const c = f.is_consigned;
      const payload = {
        name: f.name.trim(),
        item_code: f.item_code.trim().toUpperCase(),
        category_id: f.category_id || null,
        unit: f.unit.trim(),
        unit_cost: Number(f.unit_cost || 0),
        selling_price: Number(f.selling_price || 0),
        reorder_level: c ? 0 : Number(f.reorder_level || 0),
        supplier_id: c ? null : f.supplier_id || null,
        expiration_date: c ? null : f.expiration_date || null,
        default_consignee: c ? null : f.default_consignee.trim() || null,
        description: f.description.trim() || null,
        is_consigned: c,
        consignee_id: c ? f.consignee_id : null,
      };
      if (editing) {
        if (!payload.item_code) delete (payload as Partial<typeof payload>).item_code;
        unwrap(await supabase.from('inventory_items').update(payload).eq('id', item!.id).select('id').single());
        return item!.id;
      }
      return rpc<string>('create_inventory_item', { p: { ...payload, initial_quantity: Number(f.initial_quantity || 0) } });
    },
    {
      success: editing ? 'Item updated.' : 'Item added to inventory.',
      onSuccess: (id) => {
        onOpenChange(false);
        onSaved?.(id as string);
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const err: typeof errors = {};
    if (!f.name.trim()) err.name = 'Item name is required.';
    if (editing && !f.item_code.trim()) err.item_code = 'Item code is required.';
    if (!f.unit.trim()) err.unit = 'Unit is required.';
    if (f.is_consigned && !f.consignee_id) err.consignee_id = 'Choose the consignee.';
    if (editing && f.is_consigned && !item!.is_consigned && toNumber(item!.quantity_on_hand) !== 0)
      err.consignee_id = 'This item still has stock on hand. Adjust it to zero before marking it consigned.';
    for (const k of ['unit_cost', 'selling_price', 'reorder_level', 'initial_quantity'] as const) {
      if (f[k] !== '' && (Number.isNaN(Number(f[k])) || Number(f[k]) < 0)) err[k] = 'Must be zero or more.';
    }
    if (f.selling_price === '') err.selling_price = 'Selling price is required.';
    setErrors(err);
    if (Object.keys(err).length === 0) save.mutate(undefined);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Edit ${item!.name}` : 'Add product'}
      description={editing ? 'Quantity on hand changes only through stock-in, sales and adjustments.' : 'Register a product sold or used by the canteen.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-[13px] font-medium">Item type</div>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {[
              { v: false, title: 'Canteen stock', desc: 'Bought and owned by the canteen. Stock is tracked and deducted when sold.' },
              { v: true, title: 'Consigned item', desc: 'Brought in by a consignee. Sold through daily sales; not stock-tracked.' },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                role="radio"
                aria-checked={f.is_consigned === o.v}
                onClick={() => setF((s) => ({ ...s, is_consigned: o.v }))}
                className={cn(
                  'rounded-xl border px-3.5 py-3 text-left transition-colors',
                  f.is_consigned === o.v ? 'border-brand-500 bg-brand-50' : 'border-surface-border hover:bg-surface-page',
                )}
              >
                <div className="text-sm font-semibold">{o.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{o.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <Field label="Item name" required error={errors.name} className="sm:col-span-2">
          <Input value={f.name} onChange={set('name')} aria-invalid={!!errors.name} autoFocus placeholder={f.is_consigned ? 'e.g. Hot cake' : 'e.g. Bottled water – small'} />
        </Field>
        {f.is_consigned && (
          <Field label="Consignee" required error={errors.consignee_id} hint="Manage the list under Inventory → Consignees.">
            <Select value={f.consignee_id} onChange={set('consignee_id')} aria-invalid={!!errors.consignee_id}>
              <option value="">— Select consignee —</option>
              {consignees.filter((c) => c.is_active || c.id === f.consignee_id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Item code" required={editing} error={errors.item_code} hint={editing ? 'Unique identifier.' : 'Leave blank to generate one automatically.'}>
          <Input value={f.item_code} onChange={set('item_code')} aria-invalid={!!errors.item_code} className="uppercase" placeholder={editing ? '' : f.is_consigned ? 'CN-0001' : 'ITM-0001'} />
        </Field>
        <Field label="Category">
          <Select value={f.category_id} onChange={set('category_id')}>
            <option value="">— Select —</option>
            {categories.filter((c) => c.is_active || c.id === f.category_id).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit of measurement" required error={errors.unit}>
          <Input list="units" value={f.unit} onChange={set('unit')} aria-invalid={!!errors.unit} />
          <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        <Field
          label={f.is_consigned ? 'Cost price (paid to consignee per piece)' : 'Purchase cost per unit'}
          error={errors.unit_cost}
          hint={f.is_consigned ? 'Optional. What the consignee receives per piece sold.' : undefined}
        >
          <Input type="number" min={0} step="0.01" prefix="₱" value={f.unit_cost} onChange={set('unit_cost')} />
        </Field>
        <Field label="Selling price" required error={errors.selling_price}>
          <Input type="number" min={0} step="0.01" prefix="₱" value={f.selling_price} onChange={set('selling_price')} aria-invalid={!!errors.selling_price} />
        </Field>
        {!f.is_consigned && (
          <>
            {!editing && (
              <Field label="Initial stock quantity" error={errors.initial_quantity} hint="Recorded as the opening entry in the stock ledger.">
                <Input type="number" min={0} step="any" value={f.initial_quantity} onChange={set('initial_quantity')} />
              </Field>
            )}
            <Field label="Reorder level" error={errors.reorder_level} hint="Low-stock alert at or below this quantity.">
              <Input type="number" min={0} step="any" value={f.reorder_level} onChange={set('reorder_level')} />
            </Field>
            <Field label="Supplier">
              <Select value={f.supplier_id} onChange={set('supplier_id')}>
                <option value="">— None —</option>
                {suppliers.filter((s) => s.is_active || s.id === f.supplier_id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {settings?.expiration_tracking !== false && (
              <Field label="Expiration date">
                <Input type="date" value={f.expiration_date} onChange={set('expiration_date')} />
              </Field>
            )}
          </>
        )}
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={set('description')} rows={2} />
        </Field>
        {f.is_consigned ? (
          <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-info-50 px-4 py-3 text-sm">
            <span className="text-ink-muted">Margin per piece (selling − cost)</span>
            <span className="tabular font-semibold text-info-600">{peso(toNumber(f.selling_price) - toNumber(f.unit_cost))}</span>
          </div>
        ) : (
          !editing && (
            <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 text-sm">
              <span className="text-ink-muted">Expected stock value</span>
              <span className="tabular font-semibold text-brand-700">{peso(expectedValue)}</span>
            </div>
          )
        )}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------- stock-in
export function StockInDialog({ open, onOpenChange, itemId }: { open: boolean; onOpenChange: (o: boolean) => void; itemId?: string }) {
  const { data: items = [] } = useInventory();
  const { data: suppliers = [] } = useSuppliers();
  const { can } = useAuth();
  const { workingDate } = useApp();
  const [key, setKey] = useState(uuid());
  const [f, setF] = useState({ item_id: '', quantity: '', unit_cost: '', supplier_id: '', new_supplier: '', date_received: workingDate, reference_no: '', remarks: '', record_as_expense: false });
  useEffect(() => {
    if (open) {
      const it = items.find((i) => i.id === itemId);
      setKey(uuid());
      setF({
        item_id: itemId ?? '',
        quantity: '',
        unit_cost: it ? String(toNumber(it.unit_cost)) : '',
        supplier_id: it?.supplier_id ?? '',
        new_supplier: '',
        date_received: workingDate,
        reference_no: '',
        remarks: '',
        record_as_expense: false,
      });
    }
  }, [open, itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = items.find((i) => i.id === f.item_id);
  const total = round2(toNumber(f.quantity) * toNumber(f.unit_cost));

  const save = useAction(
    async () => {
      let supplierId = f.supplier_id || null;
      if (f.supplier_id === '__new' && f.new_supplier.trim()) {
        const s = unwrap(await supabase.from('suppliers').insert({ name: f.new_supplier.trim() }).select('id').single()) as { id: string };
        supplierId = s.id;
      }
      return rpc('record_stock_in', {
        p: {
          item_id: f.item_id,
          quantity: Number(f.quantity),
          unit_cost: Number(f.unit_cost || 0),
          supplier_id: supplierId === '__new' ? null : supplierId,
          date_received: f.date_received,
          reference_no: f.reference_no,
          remarks: f.remarks,
          record_as_expense: f.record_as_expense,
          idempotency_key: key,
        },
      });
    },
    { success: 'Stock received and inventory updated.', onSuccess: () => onOpenChange(false), invalidate: undefined },
  );

  const invalid = !f.item_id || !(Number(f.quantity) > 0) || Number(f.unit_cost) < 0 || !f.date_received || f.date_received > todayPH();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record stock received"
      description="Increases quantity on hand and records a permanent stock-in entry."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={invalid}>
            Record stock-in
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item" required className="sm:col-span-2">
          <Select
            value={f.item_id}
            onChange={(e) => {
              const it = items.find((i) => i.id === e.target.value);
              setF((s) => ({ ...s, item_id: e.target.value, unit_cost: it ? String(toNumber(it.unit_cost)) : s.unit_cost, supplier_id: it?.supplier_id ?? s.supplier_id }));
            }}
          >
            <option value="">— Select item —</option>
            {items.filter((i) => !i.is_consigned).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.item_code}) — {qty(i.quantity_on_hand)} {i.unit} on hand
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity received${item ? ` (${item.unit})` : ''}`} required>
          <Input type="number" min={0} step="any" value={f.quantity} onChange={(e) => setF((s) => ({ ...s, quantity: e.target.value }))} autoFocus />
        </Field>
        <Field label="Purchase cost per unit" required>
          <Input type="number" min={0} step="0.01" prefix="₱" value={f.unit_cost} onChange={(e) => setF((s) => ({ ...s, unit_cost: e.target.value }))} />
        </Field>
        <Field label="Supplier">
          <Select value={f.supplier_id} onChange={(e) => setF((s) => ({ ...s, supplier_id: e.target.value }))}>
            <option value="">— None —</option>
            {suppliers.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">+ New supplier…</option>
          </Select>
        </Field>
        {f.supplier_id === '__new' ? (
          <Field label="New supplier name" required>
            <Input value={f.new_supplier} onChange={(e) => setF((s) => ({ ...s, new_supplier: e.target.value }))} />
          </Field>
        ) : (
          <Field label="Date received" required>
            <Input type="date" max={todayPH()} value={f.date_received} onChange={(e) => setF((s) => ({ ...s, date_received: e.target.value }))} />
          </Field>
        )}
        {f.supplier_id === '__new' && (
          <Field label="Date received" required>
            <Input type="date" max={todayPH()} value={f.date_received} onChange={(e) => setF((s) => ({ ...s, date_received: e.target.value }))} />
          </Field>
        )}
        <Field label="Reference / receipt no.">
          <Input value={f.reference_no} onChange={(e) => setF((s) => ({ ...s, reference_no: e.target.value }))} />
        </Field>
        <Field label="Remarks" className="sm:col-span-2">
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF((s) => ({ ...s, remarks: e.target.value }))} />
        </Field>
        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 text-sm">
          <span className="text-ink-muted">Total purchase cost</span>
          <span className="tabular font-semibold text-brand-700">{peso(total)}</span>
        </div>
        {can('finance.record') && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={f.record_as_expense}
              onChange={(v) => setF((s) => ({ ...s, record_as_expense: v }))}
              label="Also record this purchase as a canteen expense"
              description="Leave unchecked if the purchase is already listed in Expenses & Other Sales, to avoid counting it twice."
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------- adjustments
export function AdjustDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: InventoryItem | null }) {
  const { data: settings } = useSettings();
  const { can } = useAuth();
  const [type, setType] = useState<InvTxnType>('damaged');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [key, setKey] = useState(uuid());
  useEffect(() => {
    if (open) {
      setType('damaged');
      setQuantity('');
      setReason('');
      setAllowNegative(false);
      setKey(uuid());
    }
  }, [open]);
  const permitted = ADJUSTMENT_TYPES.filter((t) => !settings || settings.permitted_adjustments.includes(t.value));
  const onHand = toNumber(item?.quantity_on_hand);
  const n = Number(quantity);
  const delta = type === 'count_correction' ? n - onHand : type === 'other_adjustment' ? n : -n;
  const after = onHand + (Number.isFinite(delta) ? delta : 0);

  const save = useAction(
    () =>
      rpc('adjust_stock', {
        p_item_id: item!.id,
        p_type: type,
        p_quantity: n,
        p_reason: reason.trim(),
        p_allow_negative: allowNegative,
        p_idempotency_key: key,
      }),
    { success: 'Stock adjustment recorded.', onSuccess: () => onOpenChange(false) },
  );

  const invalid =
    quantity === '' ||
    Number.isNaN(n) ||
    reason.trim().length < 3 ||
    (type === 'count_correction' ? n < 0 || n === onHand : type === 'other_adjustment' ? n === 0 : n <= 0) ||
    (after < 0 && !allowNegative);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Adjust stock — ${item?.name ?? ''}`}
      description="Every adjustment is permanent, requires a reason and records who made it."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={invalid}>
            Record adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Adjustment type" required hint={ADJUSTMENT_TYPES.find((t) => t.value === type)?.help}>
          <Select value={type} onChange={(e) => setType(e.target.value as InvTxnType)}>
            {permitted.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={type === 'count_correction' ? `Physical count (${item?.unit})` : type === 'other_adjustment' ? `Change in quantity (${item?.unit}, negative to remove)` : `Quantity removed (${item?.unit})`}
          required
        >
          <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 6 pieces of turon spoiled — not sold by end of day" />
        </Field>
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-surface-page p-3 text-center text-sm">
          <div>
            <div className="text-xs text-ink-muted">On hand</div>
            <div className="tabular font-semibold">{qty(onHand)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Change</div>
            <div className={`tabular font-semibold ${delta < 0 ? 'text-danger-600' : 'text-brand-600'}`}>{quantity === '' ? '—' : (delta > 0 ? '+' : '') + qty(delta)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">After</div>
            <div className={`tabular font-semibold ${after < 0 ? 'text-danger-600' : ''}`}>{quantity === '' ? '—' : qty(after)}</div>
          </div>
        </div>
        {after < 0 && quantity !== '' && (
          can('inventory.negative_exception') ? (
            <Callout tone="warning" title="This would make stock negative">
              <Checkbox checked={allowNegative} onChange={setAllowNegative} label="Authorise a documented negative-stock exception" description="The reason above is recorded as the justification." />
            </Callout>
          ) : (
            <Callout tone="danger">Stock cannot go below zero. Only an administrator can authorise an exception.</Callout>
          )
        )}
      </div>
    </Dialog>
  );
}

export function useArchiveItem() {
  return useAction(
    async ({ id, active }: { id: string; active: boolean }) => {
      unwrap(await supabase.from('inventory_items').update({ is_active: active }).eq('id', id).select('id').single());
      return active;
    },
    { success: (a) => (a ? 'Item restored.' : 'Item archived.'), invalidate: [keys.inventory, keys.alerts, keys.reports] },
  );
}

export function notifyError(e: unknown) {
  toast.error((e as Error).message);
}
