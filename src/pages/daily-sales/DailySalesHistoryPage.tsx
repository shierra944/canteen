import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ShoppingBasket } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { useDailySales } from '@/lib/queries';
import { formatDate, peso, qty, toNumber } from '@/lib/utils';
import { describePeriod } from '@/lib/periods';
import { PageHeader } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Pagination, SortTH, Table, TD, TH, THead, TR, sortRows, type SortDir } from '@/components/ui/table';
import { FilterBar, FilterField } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import type { OfficialReport } from '@/lib/export/report';
import type { DailySale } from '@/lib/types';
import { NewSaleButton } from './NewSaleButton';

const PAGE = 20;

export default function DailySalesHistoryPage() {
  const { can } = useAuth();
  const { schoolYears, activeSchoolYear } = useApp();
  const navigate = useNavigate();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sy, setSy] = useState(activeSchoolYear?.id ?? '');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: keyof DailySale; dir: SortDir }>({ key: 'sale_date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const { data = [], isLoading, error, refetch } = useDailySales({ start: start || undefined, end: end || undefined, schoolYearId: sy || undefined, status: status || undefined });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const r = data.filter((d) => !s || d.sale_date.includes(s) || formatDate(d.sale_date, 'long').toLowerCase().includes(s) || (d.created_by_name ?? '').toLowerCase().includes(s));
    return sortRows(r, sort.key, sort.dir);
  }, [data, search, sort]);
  const totals = useMemo(
    () => ({
      sales_amount: rows.filter((r) => r.status === 'finalized').reduce((a, r) => a + toNumber(r.sales_amount), 0),
      units_sold: rows.filter((r) => r.status === 'finalized').reduce((a, r) => a + toNumber(r.units_sold), 0),
      canteen_shares: rows.filter((r) => r.status === 'finalized').reduce((a, r) => a + toNumber(r.canteen_shares), 0),
    }),
    [rows],
  );
  const active = Boolean(start || end || status || search || sy !== (activeSchoolYear?.id ?? ''));
  const syName = schoolYears.find((y) => y.id === sy)?.name;

  const report = (): OfficialReport => ({
    title: 'Daily Sales History',
    period: start || end ? describePeriod(start || rows[rows.length - 1]?.sale_date || end, end || rows[0]?.sale_date || start) : syName ? `School Year ${syName}` : 'All records',
    schoolYear: syName,
    filename: `QNHS-Daily-Sales-History`,
    columns: [
      { key: 'sale_date', header: 'Date', format: 'date', width: 16 },
      { key: 'line_count', header: 'Items', format: 'qty', width: 8 },
      { key: 'units_sold', header: 'Units Sold', format: 'qty', width: 12 },
      { key: 'sales_amount', header: 'Gross Sales Amount', format: 'peso', width: 16 },
      { key: 'canteen_shares', header: 'Canteen Shares', format: 'peso', width: 14 },
      { key: 'actual_money', header: 'Actual Money', format: 'peso', width: 14 },
      { key: 'created_by_name', header: 'Recorded By', width: 20 },
      { key: 'status', header: 'Status', width: 12 },
    ],
    rows: rows.map((r) => ({ ...r })),
    totals: { sale_date: 'TOTAL (finalized)', units_sold: totals.units_sold, sales_amount: totals.sales_amount, canteen_shares: totals.canteen_shares },
  });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Daily Sales"
          description="One record per school day, following the DAILY SALES sheet. Finalizing a record deducts sold quantities from inventory."
          actions={
            <>
              <ExportMenu report={report} disabled={rows.length === 0} />
              {can('sales.record') && <NewSaleButton />}
            </>
          }
        />
        <Card>
          <FilterBar
            active={active}
            onClear={() => {
              setStart('');
              setEnd('');
              setStatus('');
              setSearch('');
              setSy(activeSchoolYear?.id ?? '');
            }}
          >
            <FilterField label="Search" className="min-w-[200px] flex-1">
              <Input placeholder="Date or recorder" value={search} onChange={(e) => setSearch(e.target.value)} />
            </FilterField>
            <FilterField label="From">
              <Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPage(1); }} />
            </FilterField>
            <FilterField label="To">
              <Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPage(1); }} />
            </FilterField>
            <FilterField label="School year">
              <Select value={sy} onChange={(e) => { setSy(e.target.value); setPage(1); }}>
                <option value="">All school years</option>
                {schoolYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    SY {y.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Status">
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="finalized">Finalized</option>
              </Select>
            </FilterField>
          </FilterBar>
          {error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<ShoppingBasket />}
              title="No daily sales records"
              description={data.length === 0 && !active ? 'Create the first record for a school day.' : 'No records match the filters.'}
              action={can('sales.record') && <NewSaleButton>New record</NewSaleButton>}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <SortTH label="Date" sortKey="sale_date" sort={sort} onSort={setSort} />
                    <SortTH label="Gross sales" sortKey="sales_amount" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Items sold" sortKey="units_sold" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Canteen shares" sortKey="canteen_shares" sort={sort} onSort={setSort} align="right" />
                    <SortTH label="Recorded by" sortKey="created_by_name" sort={sort} onSort={setSort} />
                    <TH>Status</TH>
                    <TH align="right">Actions</TH>
                  </tr>
                </THead>
                <tbody>
                  {rows.slice((page - 1) * PAGE, page * PAGE).map((d) => (
                    <TR key={d.id} onClick={() => navigate(`/daily-sales/${d.id}`)}>
                      <TD className="whitespace-nowrap font-medium">
                        {formatDate(d.sale_date, 'long')}
                        <div className="text-xs font-normal text-ink-muted">{new Intl.DateTimeFormat('en-PH', { weekday: 'long' }).format(new Date(d.sale_date + 'T00:00'))}</div>
                      </TD>
                      <TD align="right" className="font-semibold">
                        {peso(d.sales_amount)}
                      </TD>
                      <TD align="right">
                        {qty(d.units_sold)} <span className="text-xs text-ink-muted">/ {d.line_count} items</span>
                      </TD>
                      <TD align="right">{peso(d.canteen_shares)}</TD>
                      <TD className="text-ink-muted">{d.created_by_name ?? '—'}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge status={d.status} />
                          {d.correction_count > 0 && <Badge tone="blue">Corrected ×{d.correction_count}</Badge>}
                          {d.source === 'import' && <Badge>Imported</Badge>}
                        </div>
                      </TD>
                      <TD align="right">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/daily-sales/${d.id}`); }}>
                          <Eye /> Open
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-surface-border bg-surface-page/80 font-semibold">
                    <TD>Total (finalized)</TD>
                    <TD align="right">{peso(totals.sales_amount)}</TD>
                    <TD align="right">{qty(totals.units_sold)}</TD>
                    <TD align="right">{peso(totals.canteen_shares)}</TD>
                    <TD colSpan={3} />
                  </tr>
                </tfoot>
              </Table>
              <Pagination page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
            </>
          )}
        </Card>
      </div>
      <PrintableReport report={rows.length ? report() : null} />
    </>
  );
}
