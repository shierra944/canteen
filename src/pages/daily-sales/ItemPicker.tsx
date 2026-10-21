import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Link2, Plus } from 'lucide-react';
import { cn, peso, qty } from '@/lib/utils';
import type { InventoryItem } from '@/lib/types';

/**
 * Searchable product picker. Selecting an inventory item links the line
 * (price auto-filled, stock deducted on finalize). Free text is allowed for
 * consigned goods that the canteen does not stock.
 */
export function ItemPicker({
  value,
  linkedId,
  items,
  disabled,
  invalid,
  onText,
  onPick,
  onCreate,
}: {
  value: string;
  linkedId: string | null;
  items: InventoryItem[];
  disabled?: boolean;
  invalid?: boolean;
  onText: (text: string) => void;
  onPick: (item: InventoryItem) => void;
  onCreate?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const s = value.trim().toLowerCase();
    return items
      .filter((i) => i.is_active && (!s || i.name.toLowerCase().includes(s) || i.item_code.toLowerCase().includes(s)))
      .slice(0, 8);
  }, [items, value]);
  useEffect(() => setActive(0), [value]);
  const exact = items.some((i) => i.name.toLowerCase() === value.trim().toLowerCase());

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            disabled={disabled}
            aria-invalid={invalid}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              onText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(matches.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && open && matches[active]) {
                e.preventDefault();
                onPick(matches[active]);
                setOpen(false);
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search or type item"
            className={cn(
              'h-9 w-full min-w-[180px] rounded-lg border border-transparent bg-transparent px-2 text-sm hover:border-surface-border focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:hover:border-transparent',
              linkedId && 'pr-7',
              invalid && 'border-danger-500',
            )}
          />
          {linkedId && <Link2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-brand-600" aria-label="Linked to inventory" />}
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
          className="z-50 w-[340px] rounded-xl border border-surface-border bg-white p-1.5 shadow-raised"
        >
          {matches.length === 0 && !value.trim() && <div className="px-3 py-2 text-xs text-ink-muted">No inventory items yet.</div>}
          {matches.map((i, idx) => (
            <button
              key={i.id}
              type="button"
              onMouseEnter={() => setActive(idx)}
              onClick={() => {
                onPick(i);
                setOpen(false);
              }}
              className={cn('flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left', idx === active ? 'bg-brand-50' : 'hover:bg-surface-page')}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{i.name}</span>
                <span className="text-xs text-ink-muted">
                  {i.item_code} · {qty(i.quantity_on_hand)} {i.unit} on hand
                </span>
              </span>
              <span className="tabular text-sm font-medium text-brand-700">{peso(i.selling_price)}</span>
            </button>
          ))}
          {value.trim() && !exact && (
            <div className="mt-1 border-t border-surface-border pt-1">
              <div className="px-3 py-1.5 text-xs text-ink-muted">
                Keep “{value.trim()}” as a consigned item (not tracked in inventory)
              </div>
              {onCreate && (
                <button
                  type="button"
                  onClick={() => {
                    onCreate(value.trim());
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  <Plus className="size-4" /> Add “{value.trim()}” to inventory
                </button>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
