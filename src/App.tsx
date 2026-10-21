import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2, ShieldX } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { AppProvider } from '@/providers/app';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { LoginPage, InactiveAccount, NotConfigured } from '@/pages/auth/LoginPage';

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage'));
const ItemDetailPage = lazy(() => import('@/pages/inventory/ItemDetailPage'));
const DailySalesHistoryPage = lazy(() => import('@/pages/daily-sales/DailySalesHistoryPage'));
const DailySaleEditorPage = lazy(() => import('@/pages/daily-sales/DailySaleEditorPage'));
const FinancePage = lazy(() => import('@/pages/finance/FinancePage'));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'));
const FundsPage = lazy(() => import('@/pages/funds/FundsPage'));
const TransactionsPage = lazy(() => import('@/pages/transactions/TransactionsPage'));
const UsersPage = lazy(() => import('@/pages/users/UsersPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const ImportPage = lazy(() => import('@/pages/settings/ImportPage'));
const AccountPage = lazy(() => import('@/pages/auth/AccountPage'));

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-page">
      <img src="/logos/qnhs.png" alt="" className="size-16 animate-pulse rounded-full" />
      <Loader2 className="size-5 animate-spin text-brand-600" />
    </div>
  );
}

/** Route guard; the database enforces the same permission independently. */
function Guard({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (anyOf.length > 0 && !anyOf.some(can)) {
    return (
      <div className="card">
        <EmptyState
          icon={<ShieldX />}
          title="You don't have access to this page"
          description="Ask an administrator to grant you the required permission."
        />
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) return <NotConfigured />;
  if (loading) return <FullScreenLoader />;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    );
  }
  if (!profile) return <FullScreenLoader />;
  if (!profile.is_active) return <InactiveAccount />;

  return (
    <AppProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<Navigate to={(location.state as { from?: string })?.from ?? '/'} replace />} />
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="inventory/:id" element={<ItemDetailPage />} />
            <Route path="daily-sales" element={<Guard anyOf={['sales.record', 'reports.view']}><DailySalesHistoryPage /></Guard>} />
            <Route path="daily-sales/new" element={<Guard anyOf={['sales.record']}><DailySaleEditorPage /></Guard>} />
            <Route path="daily-sales/:id" element={<Guard anyOf={['sales.record', 'reports.view']}><DailySaleEditorPage /></Guard>} />
            <Route path="finance" element={<Guard anyOf={['finance.record', 'reports.view']}><FinancePage /></Guard>} />
            <Route path="reports" element={<Guard anyOf={['reports.view']}><ReportsPage /></Guard>} />
            <Route path="funds" element={<Guard anyOf={['reports.view', 'funds.manage']}><FundsPage /></Guard>} />
            <Route path="transactions" element={<Guard anyOf={['reports.view', 'audit.view']}><TransactionsPage /></Guard>} />
            <Route path="users" element={<Guard anyOf={['users.manage']}><UsersPage /></Guard>} />
            <Route path="settings" element={<Guard anyOf={['settings.manage', 'import.run']}><SettingsPage /></Guard>} />
            <Route path="settings/import" element={<Guard anyOf={['import.run']}><ImportPage /></Guard>} />
            <Route path="account" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AppProvider>
  );
}
