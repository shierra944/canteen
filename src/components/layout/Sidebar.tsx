import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, LogOut, X } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useAuth } from '@/providers/auth';
import { cn, initials } from '@/lib/utils';
import { ROLE_LABEL } from '@/lib/labels';
import { NAV_ITEMS, canSee } from './nav';

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { profile, can, signOut } = useAuth();
  const items = NAV_ITEMS.filter((i) => canSee(i, can));

  const content = (isMobile: boolean) => {
    const mini = collapsed && !isMobile;
    return (
      <div className="flex h-full flex-col bg-brand-700 text-white">
        {/* Brand */}
        <div className={cn('flex items-center gap-3 border-b border-white/10 px-4 py-5', mini && 'justify-center px-2')}>
          <img src="/logos/qnhs.png" alt="Quiot National High School logo" className={cn('shrink-0 rounded-full bg-white p-0.5 shadow-sm', mini ? 'size-10' : 'size-12')} />
          {!mini && (
            <div className="min-w-0 leading-tight">
              <div className="text-[15px] font-bold tracking-wide">QNHS CANTEEN</div>
              <div className="mt-0.5 text-[11px] text-white/65">Inventory &amp; Financial Management</div>
            </div>
          )}
          {isMobile && (
            <button onClick={onCloseMobile} className="ml-auto rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Close menu">
              <X className="size-5" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          {!mini && <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">Menu</div>}
          {items.map((item) => {
            const link = (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={isMobile ? onCloseMobile : undefined}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                    mini && 'justify-center px-0',
                    isActive ? 'bg-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-white/70 hover:bg-white/[0.07] hover:text-white',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gold-400" aria-hidden />}
                    <item.icon className={cn('size-[18px] shrink-0', isActive ? 'text-gold-300' : 'text-white/60 group-hover:text-white')} />
                    {!mini && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            );
            return mini ? (
              <Tooltip.Root key={item.to} delayDuration={150}>
                <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="right" sideOffset={10} className="z-50 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-raised">
                    {item.label}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            ) : (
              link
            );
          })}
        </nav>

        {/* Collapse */}
        {!isMobile && (
          <button
            onClick={onToggle}
            className={cn('mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/55 hover:bg-white/[0.07] hover:text-white', collapsed && 'justify-center px-0')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && 'Collapse'}
          </button>
        )}

        {/* User */}
        <div className={cn('flex items-center gap-3 border-t border-white/10 px-4 py-4', mini && 'flex-col px-2')}>
          <NavLink to="/account" onClick={isMobile ? onCloseMobile : undefined} className="flex min-w-0 flex-1 items-center gap-3" title="My account">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-400 text-[13px] font-bold text-brand-800">
              {initials(profile?.full_name)}
            </div>
            {!mini && (
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{profile?.full_name || '—'}</div>
                <div className="truncate text-[11px] text-white/55">{profile ? ROLE_LABEL[profile.role] : ''}</div>
              </div>
            )}
          </NavLink>
          <button onClick={() => void signOut()} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <Tooltip.Provider>
      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 lg:block',
          collapsed ? 'w-[76px]' : 'w-[264px]',
        )}
      >
        {content(false)}
      </aside>
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onCloseMobile} />
          <div className="absolute inset-y-0 left-0 w-[280px] animate-slide-in-left shadow-overlay">{content(true)}</div>
        </div>
      )}
    </Tooltip.Provider>
  );
}
