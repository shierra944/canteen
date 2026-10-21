import type { ReactNode } from 'react';
import * as T from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <T.List
      className={cn(
        'scrollbar-thin inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-surface-border bg-white p-1 shadow-card',
        className,
      )}
    >
      {children}
    </T.List>
  );
}

export function TabsTrigger({ value, children, icon }: { value: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <T.Trigger
      value={value}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink data-[state=active]:bg-brand-600 data-[state=active]:text-white data-[state=active]:shadow-sm [&_svg]:size-4"
    >
      {icon}
      {children}
    </T.Trigger>
  );
}
