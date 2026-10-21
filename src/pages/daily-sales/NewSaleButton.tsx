import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { formatDate, todayPH } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';

function shiftDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "New daily sales record": asks which day first, so sales of past days can be
 * recorded. A day that already has a record opens that record instead.
 */
export function NewSaleButton({ children, size, variant }: { children?: ReactNode; size?: 'sm'; variant?: 'secondary' }) {
  const navigate = useNavigate();
  const today = todayPH();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const error = !date ? 'Choose a date.' : date > today ? 'Date cannot be in the future.' : null;

  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (error) return;
    setBusy(true);
    const { data, error: err } = await supabase.from('daily_sales').select('id').eq('sale_date', date).maybeSingle();
    setBusy(false);
    if (err) return toast.error(err.message);
    setOpen(false);
    if (data) {
      toast.info(`A record for ${formatDate(date, 'long')} already exists — opening it.`);
      navigate(`/daily-sales/${data.id}`);
    } else navigate(`/daily-sales/new?date=${date}`);
  }

  const quick = [
    { label: 'Today', value: today },
    { label: 'Yesterday', value: shiftDays(today, -1) },
  ];

  return (
    <>
      <Button size={size} variant={variant} onClick={() => { setDate(today); setOpen(true); }}>
        <Plus /> {children ?? 'New daily sales record'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="Record daily sales"
        description="Choose the day to record. Past days can be recorded too."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="pick-sale-date" loading={busy} disabled={!!error}>
              <CalendarDays /> Open sheet
            </Button>
          </>
        }
      >
        <form id="pick-sale-date" onSubmit={go} className="space-y-3" noValidate>
          <Field label="Sales date" required error={error}>
            <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} autoFocus />
          </Field>
          <div className="flex gap-2">
            {quick.map((q) => (
              <Button key={q.label} type="button" size="sm" variant={date === q.value ? 'secondary' : 'ghost'} onClick={() => setDate(q.value)}>
                {q.label}
              </Button>
            ))}
          </div>
          {date && !error && <p className="text-xs text-ink-muted">Recording sales for {formatDate(date, 'long')}.</p>}
        </form>
      </Dialog>
    </>
  );
}
