import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Boxes, CalendarDays, FileSpreadsheet, GitCompare, Receipt, ShoppingBasket, X } from 'lucide-react';
import { useApp } from '@/providers/app';
import { describePeriod, monthRange, resolvePeriod, type Period } from '@/lib/periods';
import { PageHeader } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterField, PeriodPicker } from '@/components/shared';
import { useCategories } from '@/lib/queries';
import { ConsolidatedReport, MonthlyReport } from './SummaryReports';
import { DailySalesReport, ExpensesReport, InventoryReport } from './DetailReports';
import { FinancialSummaryReport } from './FinancialSummaryReport';
import { ReconciliationReport } from './ReconciliationReport';

export interface ReportFilters {
  period: Period;
  type: string;
  item: string;
  invCategoryId: string;
}

const TABS = [
  { value: 'consolidated', label: 'Consolidated Daily', icon: <CalendarDays /> },
  { value: 'monthly', label: 'Monthly', icon: <BarChart3 /> },
  { value: 'daily-sales', label: 'Daily Sales', icon: <ShoppingBasket /> },
  { value: 'expenses', label: 'Expenses & Other Sales', icon: <Receipt /> },
  { value: 'inventory', label: 'Inventory', icon: <Boxes /> },
  { value: 'summary', label: 'Financial Summary', icon: <FileSpreadsheet /> },
  { value: 'reconciliation', label: 'Workbook Reconciliation', icon: <GitCompare /> },
];

export default function ReportsPage() {
  const { workingDate, activeSchoolYear, schoolYears } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'consolidated';
  const initial = useMemo(() => resolvePeriod('this_month', workingDate), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<ReportFilters>({ period: initial, type: '', item: '', invCategoryId: '' });
  const { data: invCats = [] } = useCategories();
  const year = Number(f.period.start.slice(0, 4));
  const month = Number(f.period.start.slice(5, 7)) - 1;
  const active = f.type || f.item || f.invCategoryId || f.period.start !== initial.start || f.period.end !== initial.end;
  const years = useMemo(() => {
    const now = Number(workingDate.slice(0, 4));
    return Array.from({ length: 6 }, (_, i) => now - i);
  }, [workingDate]);

  const setMonth = (y: number, m: number) => setF((s) => ({ ...s, period: { key: 'custom', ...monthRange(y, m) } }));

  return (
    <>
      <div className="no-print">
        <PageHeader title="Reports" description="Official canteen reports recalculated from the underlying daily sales and transactions." />
        <Card className="mb-5">
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <FilterField label="Reporting period">
              <PeriodPicker value={f.period} onChange={(p) => setF((s) => ({ ...s, period: p }))} />
            </FilterField>
            <FilterField label="Month" className="min-w-[130px]">
              <Select value={month} onChange={(e) => setMonth(year, Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {new Intl.DateTimeFormat('en-PH', { month: 'long' }).format(new Date(2026, i, 1))}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Year" className="min-w-[100px]">
              <Select value={year} onChange={(e) => setMonth(Number(e.target.value), month)}>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="School year" className="min-w-[140px]">
              <Select
                value={schoolYears.find((y) => y.start_date === f.period.start && y.end_date === f.period.end)?.id ?? ''}
                onChange={(e) => {
                  const sy = schoolYears.find((y) => y.id === e.target.value);
                  if (sy) setF((s) => ({ ...s, period: { key: 'school_year', start: sy.start_date, end: sy.end_date } }));
                }}
              >
                <option value="">—</option>
                {schoolYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    SY {y.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Transaction type" className="min-w-[130px]">
              <Select value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value }))}>
                <option value="">All</option>
                <option value="sale">Sale</option>
                <option value="expense">Expense</option>
                <option value="deficit">Deficit</option>
              </Select>
            </FilterField>
            {(tab === 'inventory' || tab === 'daily-sales') && (
              <FilterField label="Product category" className="min-w-[160px]">
                <Select value={f.invCategoryId} onChange={(e) => setF((s) => ({ ...s, invCategoryId: e.target.value }))}>
                  <option value="">All</option>
                  {invCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )}
            <FilterField label="Item" className="min-w-[160px]">
              <Input value={f.item} onChange={(e) => setF((s) => ({ ...s, item: e.target.value }))} placeholder="Item name contains…" />
            </FilterField>
            <button
              onClick={() => setF({ period: initial, type: '', item: '', invCategoryId: '' })}
              disabled={!active}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
            >
              <X className="size-4" /> Clear filters
            </button>
          </div>
          <div className="border-t border-surface-border px-5 py-2 text-xs text-ink-muted">
            Showing <span className="font-medium text-ink">{describePeriod(f.period.start, f.period.end)}</span>
            {activeSchoolYear ? ` · active SY ${activeSchoolYear.name}` : ''}
          </div>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="no-print">
          <TabsList className="mb-5">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} icon={t.icon}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="consolidated">
          <ConsolidatedReport filters={f} />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyReport filters={f} />
        </TabsContent>
        <TabsContent value="daily-sales">
          <DailySalesReport filters={f} />
        </TabsContent>
        <TabsContent value="expenses">
          <ExpensesReport filters={f} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryReport filters={f} />
        </TabsContent>
        <TabsContent value="summary">
          <FinancialSummaryReport filters={f} />
        </TabsContent>
        <TabsContent value="reconciliation">
          <ReconciliationReport />
        </TabsContent>
      </Tabs>
    </>
  );
}
