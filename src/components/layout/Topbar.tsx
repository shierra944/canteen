import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { Bell, CalendarDays, Check, ChevronRight, LogOut, Menu as MenuIcon, Monitor, Moon, Search, Sun, UserRound } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/providers/theme';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { useAlerts } from '@/lib/queries';
import { cn, formatDate, initials, todayPH } from '@/lib/utils';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { ROLE_LABEL } from '@/lib/labels';
import { pageMeta } from './nav';
import { GlobalSearch } from './GlobalSearch';
import type { Alert } from '@/lib/types';

const DISMISSED_KEY = 'qnhs.dismissedAlerts';

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { pathname } = useLocation();
  const { title, crumbs } = pageMeta(pathname);
  const { profile, signOut } = useAuth();
  const { activeSchoolYear, workingDate, setWorkingDate } = useApp();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="no-print sticky top-0 z-20 border-b border-surface-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button onClick={onOpenMobile} className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken lg:hidden" aria-label="Open menu">
          <MenuIcon className="size-5" />
        </button>

        <div className="min-w-0 flex-1">
          <nav className="hidden items-center gap-1 text-xs text-ink-muted sm:flex" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-ink">
              Home
            </Link>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <span className={i === crumbs.length - 1 ? 'text-ink' : ''}>{c}</span>
              </span>
            ))}
          </nav>
          <h1 className="truncate text-[17px] font-semibold leading-tight text-ink">{title}</h1>
        </div>

        <button
          onClick={() => setSearchOpen(true)}
          className="hidden h-9 w-64 items-center gap-2 rounded-xl border border-surface-border bg-surface-page px-3 text-sm text-ink-soft transition-colors hover:border-surface-strong md:flex"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Search items, records…</span>
          <kbd className="rounded-md border border-surface-border bg-surface px-1.5 text-[10px] font-medium text-ink-muted">Ctrl K</kbd>
        </button>
        <button onClick={() => setSearchOpen(true)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken md:hidden" aria-label="Search">
          <Search className="size-5" />
        </button>

        {activeSchoolYear && (
          <div className="hidden items-center rounded-lg bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-600 ring-1 ring-inset ring-gold-500/25 xl:flex">
            SY {activeSchoolYear.name}
          </div>
        )}

        <label className="relative hidden items-center sm:flex" title="Working date — default date for new records">
          <CalendarDays className="pointer-events-none absolute left-2.5 size-4 text-ink-muted" />
          <input
            type="date"
            value={workingDate}
            max={todayPH()}
            onChange={(e) => e.target.value && setWorkingDate(e.target.value)}
            className="h-9 rounded-xl border border-surface-border bg-surface pl-8 pr-2 text-[13px] text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            aria-label="Working date"
          />
        </label>

        <ThemeToggle />
        <Notifications />

        <Menu>
          <MenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-surface-sunken" aria-label="User menu">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{initials(profile?.full_name)}</span>
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>
              <div className="text-sm font-semibold text-ink">{profile?.full_name}</div>
              <div className="font-normal">{profile?.email}</div>
              <div className="mt-1 font-normal text-brand-600">{profile ? ROLE_LABEL[profile.role] : ''}</div>
            </MenuLabel>
            <MenuSeparator />
            <MenuItem icon={<UserRound />} onSelect={() => navigate('/account')}>
              My account
            </MenuItem>
            <MenuItem icon={<LogOut />} danger onSelect={() => void signOut()}>
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

const THEMES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'Match this device', icon: Monitor },
];

function ThemeToggle() {
  const { mode, dark, setMode } = useTheme();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="rounded-xl p-2 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink" aria-label="Appearance" title="Appearance">
          {dark ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Appearance</MenuLabel>
        {THEMES.map((t) => (
          <MenuItem key={t.mode} icon={<t.icon />} onSelect={() => setMode(t.mode)}>
            <span className="flex-1">{t.label}</span>
            {mode === t.mode && <Check className="ml-3 size-4 text-brand-600" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function Notifications() {
  const { data: alerts = [] } = useAlerts();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const visible = useMemo(() => alerts.filter((a) => !dismissed.includes(a.alert_key)), [alerts, dismissed]);
  const urgent = visible.filter((a) => a.severity !== 'info').length;

  const dismiss = (keys: string[]) => {
    // keep only keys that still exist so storage stays small
    const next = [...new Set([...dismissed, ...keys])].filter((k) => alerts.some((a) => a.alert_key === k));
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — dismissal lasts for this session only */
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative rounded-lg p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink" aria-label={`Notifications (${visible.length})`}>
          <Bell className="size-5" />
          {visible.length > 0 && (
            <span
              className={cn(
                'absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white',
                urgent ? 'bg-danger-500' : 'bg-brand-500',
              )}
            >
              {visible.length > 99 ? '99+' : visible.length}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(380px,calc(100vw-1.5rem))] rounded-2xl border border-surface-border bg-surface shadow-overlay animate-scale-in">
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <div className="text-sm font-semibold">Notifications</div>
            {visible.length > 0 && (
              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => dismiss(visible.map((a) => a.alert_key))}>
                Mark all as read
              </button>
            )}
          </div>
          <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-muted">You're all caught up.</div>
            ) : (
              visible.slice(0, 50).map((a) => (
                <Popover.Close asChild key={a.alert_key}>
                  <button
                    className="flex w-full gap-3 border-b border-surface-border px-4 py-3 text-left last:border-0 hover:bg-surface-page"
                    onClick={() => {
                      dismiss([a.alert_key]);
                      if (a.link) navigate(a.link);
                    }}
                  >
                    <AlertDot alert={a} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{a.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{a.message}</span>
                      {a.occurred_on && <span className="mt-1 block text-[11px] text-ink-soft">{formatDate(a.occurred_on)}</span>}
                    </span>
                  </button>
                </Popover.Close>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AlertDot({ alert }: { alert: Pick<Alert, 'severity'> }) {
  return (
    <span
      className={cn(
        'mt-1.5 size-2 shrink-0 rounded-full',
        alert.severity === 'critical' ? 'bg-danger-500' : alert.severity === 'warning' ? 'bg-warn-500' : 'bg-info-500',
      )}
    />
  );
}
