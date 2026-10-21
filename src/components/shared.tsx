import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarRange, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PERIOD_LABELS, resolvePeriod, type Period, type PeriodKey } from '@/lib/periods';
import { useApp } from '@/providers/app';
import { isDarkNow } from '@/providers/theme';
import { ConfirmDialog } from './ui/dialog';
import { Field, Textarea } from './ui/form';

// Validated chart palette (dataviz validator): sales / expenses / net.
const CHART_LIGHT = { sales: '#087A35', expenses: '#B8930C', net: '#3D6A9E', deficit: '#B83E3A', grid: '#E4EAE5', axis: '#6B756D' };
// brighter on the dark theme so lines and bars stay legible
const CHART_DARK = { sales: '#3FBF6E', expenses: '#E0B52A', net: '#7AA7DC', deficit: '#E8706B', grid: '#1D3628', axis: '#A9B1A4' };
/** Chart colours for the current theme (read at render time). */
export const CHART = Object.defineProperties({} as typeof CHART_LIGHT, Object.fromEntries(
  (Object.keys(CHART_LIGHT) as (keyof typeof CHART_LIGHT)[]).map((k) => [k, { enumerable: true, get: () => (isDarkNow() ? CHART_DARK : CHART_LIGHT)[k] }]),
));

export function StatCard({
  label,
  value,
  icon,
  sub,
  tone = 'default',
  onClick,
  active = false,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  onClick?: () => void;
  /** The card's filter or detail view is currently selected. */
  active?: boolean;
}) {
  const iconTone = {
    default: 'bg-brand-50 text-brand-600',
    positive: 'bg-brand-50 text-brand-600',
    negative: 'bg-danger-50 text-danger-600',
    warning: 'bg-warn-50 text-warn-600',
  }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cn(
        'card flex flex-col p-5 text-left',
        onClick && 'group cursor-pointer transition-[box-shadow,border-color] hover:border-brand-200 hover:shadow-raised focus-visible:ring-2',
        active && 'border-brand-500 shadow-raised ring-2 ring-brand-500/30 hover:border-brand-500',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <span className={cn('flex size-9 items-center justify-center rounded-xl [&_svg]:size-[18px]', iconTone)}>{icon}</span>
      </div>
      <div
        className={cn(
          'tabular mt-2 text-[26px] font-semibold leading-tight tracking-tight',
          tone === 'negative' ? 'text-danger-600' : 'text-ink',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs leading-relaxed text-ink-muted">{sub}</div>}
      {onClick && (
        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-brand-600 group-hover:text-brand-700">
          View details <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      )}
    </Comp>
  );
}

/** Reporting period selector with presets + custom range. */
export function PeriodPicker({
  value,
  onChange,
  presets = ['today', 'this_week', 'this_month', 'this_quarter', 'school_year', 'custom'],
}: {
  value: Period;
  onChange: (p: Period) => void;
  presets?: PeriodKey[];
}) {
  const { workingDate, activeSchoolYear } = useApp();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="scrollbar-thin flex max-w-full overflow-x-auto rounded-xl border border-surface-border bg-surface p-1 shadow-card">
        {presets.map((k) => (
          <button
            key={k}
            onClick={() => onChange(k === 'custom' ? { key: 'custom', start: value.start, end: value.end } : resolvePeriod(k, workingDate, activeSchoolYear))}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
              value.key === k ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {PERIOD_LABELS[k]}
          </button>
        ))}
      </div>
      {value.key === 'custom' && <DateRange start={value.start} end={value.end} onChange={(s, e) => onChange({ key: 'custom', start: s, end: e })} />}
    </div>
  );
}

export function DateRange({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const cls =
    'h-9 rounded-lg border border-surface-border bg-surface px-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';
  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-surface-border bg-surface p-1 pl-2.5 shadow-card">
      <CalendarRange className="size-4 text-ink-muted" />
      <input type="date" aria-label="Start date" className={cls} value={start} max={end} onChange={(e) => e.target.value && onChange(e.target.value, end)} />
      <span className="text-xs text-ink-muted">to</span>
      <input type="date" aria-label="End date" className={cls} value={end} min={start} onChange={(e) => e.target.value && onChange(start, e.target.value)} />
    </div>
  );
}

export function FilterBar({ children, onClear, active }: { children: ReactNode; onClear?: () => void; active?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-surface-border px-5 py-4">
      {children}
      {onClear && (
        <button
          onClick={onClear}
          disabled={!active}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
        >
          <X className="size-4" /> Clear filters
        </button>
      )}
    </div>
  );
}

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-[150px] space-y-1', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      {children}
    </div>
  );
}

/** Confirmation that requires a written reason (corrections, reversals). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
  tone = 'danger',
  extra,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  loading?: boolean;
  tone?: 'danger' | 'primary';
  extra?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('');
        onOpenChange(o);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      loading={loading}
      confirmDisabled={reason.trim().length < 3}
      onConfirm={() => onConfirm(reason.trim())}
    >
      {extra}
      <Field label="Reason (recorded in the audit log)" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this is necessary…" autoFocus />
      </Field>
    </ConfirmDialog>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
