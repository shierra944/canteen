import { useEffect, useState, type FormEvent } from 'react';
import { rpc } from '@/lib/supabase';
import { useAction, useFinCategories } from '@/lib/queries';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { FIN_TYPE_LABEL } from '@/lib/labels';
import { cn, todayPH, toNumber, uuid } from '@/lib/utils';
import type { FinancialTxn, FinTxnType } from '@/lib/types';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/feedback';

const PAYMENT_METHODS = ['Cash', 'GCash', 'Bank transfer', 'Check', 'Other'];

export function TxnDialog({ open, onOpenChange, txn }: { open: boolean; onOpenChange: (o: boolean) => void; txn?: FinancialTxn | null }) {
  const { data: cats = [] } = useFinCategories();
  const { profile, can } = useAuth();
  const { workingDate } = useApp();
  const editing = Boolean(txn);
  const ownSameDay =
    editing &&
    txn!.created_by === profile?.id &&
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(txn!.created_at)) === todayPH();
  const needsReason = editing && !ownSameDay;

  const init = () => ({
    transaction_date: txn?.transaction_date ?? workingDate,
    transaction_type: (txn?.transaction_type ?? 'expense') as FinTxnType,
    category_id: txn?.category_id ?? '',
    description: txn?.description ?? '',
    requested_by: txn?.requested_by ?? '',
    amount: txn ? String(toNumber(txn.amount)) : '',
    payment_method: txn?.payment_method ?? '',
    reference_number: txn?.reference_number ?? '',
    remarks: txn?.remarks ?? '',
    included_in_daily_sales: txn?.included_in_daily_sales ?? false,
  });
  const [f, setF] = useState(init);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(uuid());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setF(init());
      setReason('');
      setErrors({});
      setKey(uuid());
    }
  }, [open, txn]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(
    async () => {
      const p = { ...f, amount: Number(f.amount), category_id: f.category_id || null };
      if (editing) return rpc('update_financial_transaction', { p_id: txn!.id, p, p_reason: reason || null, p_expected_version: txn!.version });
      return rpc('create_financial_transaction', { p: { ...p, idempotency_key: key } });
    },
    { success: editing ? 'Transaction updated.' : 'Transaction recorded.', onSuccess: () => onOpenChange(false) },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!f.transaction_date) err.transaction_date = 'Date is required.';
    else if (f.transaction_date > todayPH()) err.transaction_date = 'Date cannot be in the future.';
    if (!f.description.trim()) err.description = 'Item / description is required.';
    if (!(Number(f.amount) > 0)) err.amount = 'Enter an amount greater than zero.';
    if (needsReason && reason.trim().length < 3) err.reason = 'A correction reason is required.';
    setErrors(err);
    if (Object.keys(err).length === 0) save.mutate(undefined);
  }

  const typeCats = cats.filter((c) => c.transaction_type === f.transaction_type && (c.is_active || c.id === f.category_id));
  const typeHelp: Record<FinTxnType, string> = {
    sale: 'Revenue counted as "Other Shares" (e.g. canteen share remitted by a vendor, rice or iced water sold).',
    expense: 'Money spent for canteen operations (e.g. water, rice, transportation, salary).',
    deficit: 'A shortage (e.g. cash short vs. expected). Kept separate from expenses in every report.',
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Edit transaction FT-${txn!.txn_no}` : 'Record expense, sale or deficit'}
      description="Workbook: EXPENSES & OTHER SALES"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="txn-form" loading={save.isPending}>
            {editing ? 'Save correction' : 'Record transaction'}
          </Button>
        </>
      }
    >
      <form id="txn-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-[13px] font-medium">
            Transaction type (Nature of item) <span className="text-danger-500">*</span>
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {(['sale', 'expense', 'deficit'] as FinTxnType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={f.transaction_type === t}
                onClick={() => setF((s) => ({ ...s, transaction_type: t, category_id: '', included_in_daily_sales: t === 'sale' && s.included_in_daily_sales }))}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                  f.transaction_type === t
                    ? t === 'sale'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : t === 'expense'
                        ? 'border-gold-500 bg-gold-50 text-gold-600'
                        : 'border-danger-500 bg-danger-50 text-danger-700'
                    : 'border-surface-border text-ink-muted hover:bg-surface-page',
                )}
              >
                {FIN_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">{typeHelp[f.transaction_type]}</p>
        </div>
        <Field label="Transaction date" required error={errors.transaction_date}>
          <Input type="date" max={todayPH()} value={f.transaction_date} onChange={(e) => setF({ ...f, transaction_date: e.target.value })} />
        </Field>
        <Field label="Amount" required error={errors.amount}>
          <Input type="number" min={0} step="0.01" prefix="₱" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-invalid={!!errors.amount} />
        </Field>
        <Field label="Item / description" required error={errors.description} className="sm:col-span-2">
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. 2 gallons of water" aria-invalid={!!errors.description} />
        </Field>
        <Field label="Category">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">— Uncategorized —</option>
            {typeCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Requested by / received from">
          <Input value={f.requested_by} onChange={(e) => setF({ ...f, requested_by: e.target.value })} placeholder="e.g. Canteen-in-Charge" />
        </Field>
        <Field label="Payment method">
          <Select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reference / receipt no.">
          <Input value={f.reference_number} onChange={(e) => setF({ ...f, reference_number: e.target.value })} />
        </Field>
        <Field label="Remarks" className="sm:col-span-2">
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>
        {f.transaction_type === 'sale' && (
          <div className="sm:col-span-2 rounded-xl border border-surface-border p-3">
            <Checkbox
              checked={f.included_in_daily_sales}
              onChange={(v) => setF({ ...f, included_in_daily_sales: v })}
              label="This revenue is already included in a Daily Sales record"
              description="Checked entries are kept for reference but are NOT added to Other Shares or Gross Sales, so nothing is counted twice."
            />
          </div>
        )}
        {needsReason && (
          <div className="sm:col-span-2 space-y-3">
            <Callout tone="warning">This is a correction of a posted transaction. The previous values and your reason are kept in the audit log.</Callout>
            <Field label="Correction reason" required error={errors.reason}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
        {editing && !can('finance.correct') && !ownSameDay && <Callout tone="danger">You can only edit your own entries on the day they were recorded.</Callout>}
      </form>
    </Dialog>
  );
}
