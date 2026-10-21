import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Link2, PencilLine, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { needsInputClass } from '@/components/ui/form';

export interface ComboOption {
  id: string;
  label: string;
  sub?: string;
  right?: ReactNode;
  keywords?: string;
}

/**
 * Spreadsheet cell with a dropdown list AND an explicit "Type manually"
 * choice. In manual mode the cell is a plain text box (no list) until the
 * user switches back to the list.
 */
export function SheetCombobox({
  value,
  options,
  manual,
  linked,
  disabled,
  needsInput,
  placeholder,
  manualLabel = 'Type manually',
  emptyText = 'No matches in the list.',
  onText,
  onPick,
  onManualChange,
  onCreate,
  createLabel,
  ariaLabel,
}: {
  value: string;
  options: ComboOption[];
  manual: boolean;
  linked?: boolean;
  disabled?: boolean;
  needsInput?: boolean;
  placeholder?: string;
  manualLabel?: string;
  emptyText?: string;
  onText: (text: string) => void;
  onPick: (option: ComboOption) => void;
  onManualChange: (manual: boolean) => void;
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Opening the list shows EVERY option; it only narrows once the user types.
  const [filtering, setFiltering] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const s = filtering ? value.trim().toLowerCase() : '';
    return options
      .filter((o) => !s || `${o.label} ${o.sub ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [options, value, filtering]);
  // row 0 is always "Type manually"
  const total = matches.length + 1;
  useEffect(() => {
    if (filtering) return setActive(matches.length ? 1 : 0);
    // when just opened, highlight the current value if it is in the list
    const idx = matches.findIndex((o) => o.label.toLowerCase() === value.trim().toLowerCase());
    setActive(idx >= 0 ? idx + 1 : matches.length ? 1 : 0);
  }, [value, matches, filtering]);
  // keep the highlighted option visible while using the arrow keys
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  const openList = () => {
    if (!open) setFiltering(false);
    setOpen(true);
  };

  const chooseManual = () => {
    onManualChange(true);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const cellCls = cn(
    'h-9 w-full min-w-[170px] rounded-lg border border-surface-border bg-white px-2 pr-14 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent',
    needsInput && needsInputClass,
  );

  if (manual) {
    return (
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-required={needsInput || undefined}
          className={cellCls}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              onManualChange(false);
              setOpen(true);
              inputRef.current?.focus();
            }}
            title="Choose from the list instead"
            className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-info-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info-600 hover:bg-info-500 hover:text-white"
          >
            <PencilLine className="size-3" /> Manual
          </button>
        )}
      </div>
    );
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            disabled={disabled}
            onFocus={openList}
            onClick={openList}
            onChange={(e) => {
              onText(e.target.value);
              setFiltering(true);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(total - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && open) {
                e.preventDefault();
                if (active === 0) chooseManual();
                else if (matches[active - 1]) {
                  onPick(matches[active - 1]);
                  setOpen(false);
                }
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-required={needsInput || undefined}
            aria-expanded={open}
            role="combobox"
            className={cellCls}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-ink-muted">
            {linked && <Link2 className="size-3.5 text-brand-600" aria-label="From the list" />}
            {!disabled && <ChevronDown className="size-3.5" />}
          </span>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
          className="z-50 max-h-[380px] w-[360px] overflow-y-auto rounded-xl border border-surface-border bg-white p-1.5 shadow-raised"
        >
          <div ref={listRef}>
          <button
            type="button"
            data-idx={0}
            onMouseEnter={() => setActive(0)}
            onClick={chooseManual}
            className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-info-600', active === 0 ? 'bg-info-50' : 'hover:bg-surface-page')}
          >
            <PencilLine className="size-4" /> {manualLabel}
            {value.trim() && <span className="truncate font-normal text-ink-muted">— keep “{value.trim()}”</span>}
          </button>
          <div className="my-1 h-px bg-surface-border" />
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">{emptyText}</div>
          ) : (
            <div className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-soft">
              {filtering && value.trim() ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : `All ${matches.length}`}
            </div>
          )}
          {matches.map((o, idx) => (
            <button
              key={o.id}
              type="button"
              data-idx={idx + 1}
              onMouseEnter={() => setActive(idx + 1)}
              onClick={() => {
                onPick(o);
                setOpen(false);
              }}
              className={cn('flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left', active === idx + 1 ? 'bg-brand-50' : 'hover:bg-surface-page')}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{o.label}</span>
                {o.sub && <span className="block truncate text-xs text-ink-muted">{o.sub}</span>}
              </span>
              {o.right && <span className="shrink-0 text-sm font-medium text-brand-700">{o.right}</span>}
            </button>
          ))}
          {onCreate && value.trim() && !options.some((o) => o.label.toLowerCase() === value.trim().toLowerCase()) && (
            <>
              <div className="my-1 h-px bg-surface-border" />
              <button
                type="button"
                onClick={() => {
                  onCreate(value.trim());
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                <Plus className="size-4" /> {createLabel ? createLabel(value.trim()) : `Add “${value.trim()}”`}
              </button>
            </>
          )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
