import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { StockStatus } from '@/lib/types';
import { STOCK_STATUS_LABEL } from '@/lib/labels';

const tones = {
  green: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  gold: 'bg-gold-50 text-gold-600 ring-gold-500/25',
  amber: 'bg-warn-50 text-warn-700 ring-warn-500/25',
  red: 'bg-danger-50 text-danger-700 ring-danger-500/20',
  gray: 'bg-surface-sunken text-ink-muted ring-ink/10',
  blue: 'bg-info-50 text-info-600 ring-info-500/20',
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = 'gray', children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StockBadge({ status }: { status: StockStatus }) {
  const tone: BadgeTone = status === 'in_stock' ? 'green' : status === 'low_stock' ? 'amber' : status === 'consigned' ? 'blue' : 'red';
  return (
    <Badge tone={tone} dot>
      {STOCK_STATUS_LABEL[status]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [BadgeTone, string]> = {
    posted: ['green', 'Posted'],
    finalized: ['green', 'Finalized'],
    draft: ['gold', 'Draft'],
    reversed: ['gray', 'Reversed'],
    exception: ['red', 'Exception'],
    active: ['green', 'Active'],
    retired: ['gray', 'Retired'],
    staged: ['gold', 'Staged'],
    committed: ['green', 'Committed'],
    cancelled: ['gray', 'Cancelled'],
    valid: ['green', 'Valid'],
    invalid: ['red', 'Invalid'],
    duplicate: ['amber', 'Duplicate'],
    review: ['amber', 'Needs review'],
    imported: ['green', 'Imported'],
    skipped: ['gray', 'Skipped'],
  };
  const [tone, label] = map[status] ?? ['gray', status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function TypeBadge({ type }: { type: string }) {
  const map: Record<string, [BadgeTone, string]> = {
    sale: ['green', 'Sale'],
    expense: ['gold', 'Expense'],
    deficit: ['red', 'Deficit'],
  };
  const [tone, label] = map[type] ?? ['gray', type];
  return <Badge tone={tone}>{label}</Badge>;
}
