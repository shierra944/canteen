import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  LayoutDashboard,
  Receipt,
  Settings,
  ShoppingBasket,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown if the user has ANY of these permissions (empty = everyone). */
  anyOf: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, anyOf: [] },
  { to: '/inventory', label: 'Products & Consignees', icon: Boxes, anyOf: [] },
  { to: '/daily-sales', label: 'Daily Sales', icon: ShoppingBasket, anyOf: ['sales.record', 'reports.view'] },
  { to: '/finance', label: 'Expenses & Other Sales', icon: Receipt, anyOf: ['finance.record', 'reports.view'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, anyOf: ['reports.view'] },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, anyOf: ['reports.view', 'audit.view'] },
  { to: '/users', label: 'User Management', icon: Users, anyOf: ['users.manage'] },
  { to: '/settings', label: 'Settings', icon: Settings, anyOf: ['settings.manage', 'import.run'] },
];

export function canSee(item: { anyOf: string[] }, can: (p: string) => boolean) {
  return item.anyOf.length === 0 || item.anyOf.some(can);
}

export function pageMeta(pathname: string): { title: string; crumbs: string[] } {
  if (pathname === '/') return { title: 'Dashboard', crumbs: ['Dashboard'] };
  if (pathname.startsWith('/inventory/')) return { title: 'Product Details', crumbs: ['Products & Consignees', 'Product details'] };
  if (pathname === '/daily-sales/new') return { title: 'New Daily Sales Record', crumbs: ['Daily Sales', 'New record'] };
  if (pathname.startsWith('/daily-sales/')) return { title: 'Daily Sales Record', crumbs: ['Daily Sales', 'Record'] };
  if (pathname.startsWith('/settings/import')) return { title: 'Excel Import', crumbs: ['Settings', 'Excel import'] };
  if (pathname.startsWith('/account')) return { title: 'My Account', crumbs: ['My account'] };
  const item = NAV_ITEMS.find((n) => n.to !== '/' && pathname.startsWith(n.to));
  return item ? { title: item.label, crumbs: [item.label] } : { title: 'QNHS Canteen', crumbs: [] };
}
