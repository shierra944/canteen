import type { ReactNode } from 'react';
import { AlertTriangle, Info, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-surface-sunken', className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/[0.04]" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-1/4' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
      <Loader2 className="size-4 animate-spin" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-8 ring-brand-50/50 [&_svg]:size-5">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'gold';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: ['border-info-500/20 bg-info-50 text-info-600', Info],
    warning: ['border-warn-500/25 bg-warn-50 text-warn-700', AlertTriangle],
    danger: ['border-danger-500/20 bg-danger-50 text-danger-700', XCircle],
    gold: ['border-gold-500/30 bg-gold-50 text-gold-600', ShieldAlert],
  } as const;
  const [cls, Icon] = styles[tone];
  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn('text-[13px] leading-relaxed', title && 'mt-0.5', 'text-ink/80')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="p-5">
      <Callout
        tone="danger"
        title="Could not load data"
        action={
          onRetry && (
            <button className="text-sm font-medium underline" onClick={onRetry}>
              Retry
            </button>
          )
        }
      >
        {error instanceof Error ? error.message : String(error)}
      </Callout>
    </div>
  );
}
