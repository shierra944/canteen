import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { formatCell, type ColFormat } from '@/lib/export/report';
import { cn } from '@/lib/utils';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Skeleton } from './ui/feedback';

export interface DetailColumn<T> {
  key: string;
  header: string;
  format?: ColFormat;
  align?: 'left' | 'right';
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface DetailSection<T = Record<string, unknown>> {
  title?: string;
  columns: DetailColumn<T>[];
  rows: T[];
  totals?: Record<string, ReactNode> | null;
  empty?: string;
}

/**
 * Drill-down for a summary card: the records behind a number.
 */
export function DetailDialog({
  open,
  onOpenChange,
  title,
  description,
  summary,
  sections,
  loading,
  link,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** label/value pairs shown above the tables (e.g. a formula breakdown) */
  summary?: { label: string; value: ReactNode; strong?: boolean }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sections: DetailSection<any>[];
  loading?: boolean;
  link?: { to: string; label: string };
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={title}
      description={description}
      footer={
        <>
          {link && (
            <Button asChild variant="secondary">
              <Link to={link.to} onClick={() => onOpenChange(false)}>
                {link.label} <ArrowRight />
              </Link>
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </>
      }
    >
      <div className="space-y-6">
        {summary && summary.length > 0 && (
          <dl className="grid gap-2 rounded-xl bg-surface-page p-4 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className={cn('text-ink-muted', s.strong && 'font-semibold text-ink')}>{s.label}</dt>
                <dd className={cn('tabular', s.strong ? 'font-semibold' : 'font-medium')}>{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {loading ? (
          <Skeleton className="h-48" />
        ) : (
          sections.map((sec, si) => (
            <div key={si}>
              {sec.title && <div className="mb-2 text-sm font-semibold">{sec.title}</div>}
              {sec.rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-surface-border px-4 py-8 text-center text-sm text-ink-muted">{sec.empty ?? 'Nothing recorded.'}</div>
              ) : (
                <div className="scrollbar-thin max-h-[52vh] overflow-auto rounded-xl border border-surface-border">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-surface-page">
                      <tr>
                        {sec.columns.map((c) => (
                          <th
                            key={c.key}
                            className={cn(
                              'whitespace-nowrap border-b border-surface-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted',
                              (c.align ?? (c.format === 'peso' || c.format === 'qty' ? 'right' : 'left')) === 'right' ? 'text-right' : 'text-left',
                            )}
                          >
                            {c.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map((r, ri) => (
                        <tr key={ri} className="border-b border-surface-border last:border-0">
                          {sec.columns.map((c) => {
                            const right = (c.align ?? (c.format === 'peso' || c.format === 'qty' ? 'right' : 'left')) === 'right';
                            return (
                              <td key={c.key} className={cn('px-3 py-2', right && 'text-right tabular', c.className)}>
                                {c.render ? c.render(r) : formatCell((r as Record<string, unknown>)[c.key], c.format) || '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {sec.totals && (
                      <tfoot className="sticky bottom-0 bg-surface-page">
                        <tr className="border-t-2 border-surface-border font-semibold">
                          {sec.columns.map((c) => {
                            const right = (c.align ?? (c.format === 'peso' || c.format === 'qty' ? 'right' : 'left')) === 'right';
                            const v = sec.totals![c.key];
                            return (
                              <td key={c.key} className={cn('px-3 py-2', right && 'text-right tabular')}>
                                {v === undefined ? '' : typeof v === 'number' || typeof v === 'string' ? formatCell(v, c.format) || v : v}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
