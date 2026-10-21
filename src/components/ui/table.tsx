import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * stickyHeader: on large screens the column headings stay visible while the
 * page scrolls. They stick at the CSS variable --sticky-top (default: just
 * under the 64px top bar). The horizontal-scroll wrapper is dropped on large
 * screens because it would stop sticky positioning from working.
 */
export function Table({ className, children, stickyHeader, ...props }: HTMLAttributes<HTMLTableElement> & { stickyHeader?: boolean }) {
  return (
    <div
      className={cn(
        'scrollbar-thin w-full overflow-x-auto',
        stickyHeader && 'lg:overflow-visible lg:[&_thead_th]:sticky lg:[&_thead_th]:top-[var(--sticky-top,4rem)] lg:[&_thead_th]:z-10 lg:[&_thead_th]:bg-surface-page',
      )}
    >
      <table className={cn('w-full border-collapse text-sm', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children, className }: { children: ReactNode; className?: string }) {
  return <thead className={cn('bg-surface-page/80', className)}>{children}</thead>;
}

export function TH({ className, align, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-surface-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, onClick, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-b border-surface-border last:border-0', onClick && 'cursor-pointer transition-colors hover:bg-brand-50/40', className)}
      onClick={onClick}
      {...props}
    />
  );
}

export function TD({ className, align, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'px-4 py-3 align-middle text-ink',
        align === 'right' ? 'tabular text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export type SortDir = 'asc' | 'desc';

export function SortTH<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: SortDir };
  onSort: (s: { key: K; dir: SortDir }) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TH align={align} className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
        className={cn('inline-flex items-center gap-1 uppercase hover:text-ink', active && 'text-ink', align === 'right' && 'flex-row-reverse')}
      >
        {label}
        <Icon className={cn('size-3', !active && 'opacity-40')} />
      </button>
    </TH>
  );
}

/** pageSize 0 = show all rows */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizeOptions = [10, 15, 25, 50, 100, 0],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  /** when given, shows a "Rows per page" selector */
  onPageSize?: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  const size = pageSize > 0 ? pageSize : Math.max(total, 1);
  const pages = Math.max(1, Math.ceil(total / size));
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border px-4 py-3 text-[13px] text-ink-muted">
      <div className="flex flex-wrap items-center gap-4">
        <span className="tabular">
          {from}–{to} of {total}
        </span>
        {onPageSize && (
          <label className="inline-flex items-center gap-2">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSize(Number(e.target.value));
                onPage(1);
              }}
              className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-[13px] text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {pageSizeOptions.map((o) => (
                <option key={o} value={o}>
                  {o === 0 ? 'All' : o}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function sortRows<T>(rows: T[], key: keyof T, dir: SortDir): T[] {
  const numeric = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = numeric(av);
    const bn = numeric(bv);
    let c: number;
    if (an !== null && bn !== null) c = an - bn;
    else c = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? c : -c;
  });
}
