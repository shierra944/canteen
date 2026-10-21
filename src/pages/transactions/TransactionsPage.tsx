import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ScrollText } from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useApp } from '@/providers/app';
import { supabase, unwrap } from '@/lib/supabase';
import { describePeriod, resolvePeriod, type Period } from '@/lib/periods';
import { formatDate, formatDateTime, peso, qty, titleCase } from '@/lib/utils';
import { LEDGER_KIND_LABEL } from '@/lib/labels';
import type { AuditLog, LedgerRow, Profile } from '@/lib/types';
import type { OfficialReport } from '@/lib/export/report';
import { PageHeader } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterBar, FilterField, PeriodPicker } from '@/components/shared';
import { ExportMenu, PrintableReport } from '@/components/OfficialReport';
import { ChangeList } from '@/components/AuditTrail';

const PAGE = 30;

function useUsers() {
  return useQuery({
    queryKey: ['users', 'list-min'],
    queryFn: async () => unwrap(await supabase.from('profiles').select('id, full_name').order('full_name')) as Pick<Profile, 'id' | 'full_name'>[],
  });
}

export default function TransactionsPage() {
  const { can } = useAuth();
  const { workingDate } = useApp();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('this_month', workingDate));
  return (
    <>
      <div className="no-print">
        <PageHeader title="Transactions" description="Every stock movement, sale, expense, allocation and correction in one place, plus the audit log." />
        <div className="mb-5">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>
      <Tabs defaultValue={can('reports.view') ? 'ledger' : 'audit'}>
        <div className="no-print">
          <TabsList className="mb-5">
            {can('reports.view') && <TabsTrigger value="ledger" icon={<ArrowLeftRight />}>Transaction history</TabsTrigger>}
            {can('audit.view') && <TabsTrigger value="audit" icon={<ScrollText />}>Audit log</TabsTrigger>}
          </TabsList>
        </div>
        {can('reports.view') && (
          <TabsContent value="ledger">
            <Ledger period={period} />
          </TabsContent>
        )}
        {can('audit.view') && (
          <TabsContent value="audit">
            <Audit period={period} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

const KIND_GROUPS: { label: string; kinds: string[] }[] = [
  { label: 'Stock-in', kinds: ['stock_in'] },
  { label: 'Inventory adjustments', kinds: ['inventory_damaged', 'inventory_expired', 'inventory_spoiled', 'inventory_missing', 'inventory_count_correction', 'inventory_other_adjustment', 'inventory_opening'] },
  { label: 'Daily sales', kinds: ['daily_sale'] },
  { label: 'Expenses', kinds: ['expense'] },
  { label: 'Other sales', kinds: ['sale'] },
  { label: 'Deficits', kinds: ['deficit'] },
  { label: 'Corrections & reversals', kinds: ['inventory_sale_reversal', 'inventory_stock_in_reversal'] },
  { label: 'Cash carry-overs', kinds: ['cash_carryover'] },
];

function Ledger({ period }: { period: Period }) {
  const navigate = useNavigate();
  const { activeSchoolYear } = useApp();
  const { data: users = [] } = useUsers();
  const [group, setGroup] = useState('');
  const [user, setUser] = useState('');
  const [item, setItem] = useState('');
  const [status, setStatus] = useState('');
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [page, setPage] = useState(1);
  const filters = { group, user, item, status, minAmt, maxAmt };
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['ledger', period.start, period.end, filters],
    queryFn: async () => {
      let q = supabase.from('v_transaction_ledger').select('*').gte('txn_date', period.start).lte('txn_date', period.end).order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(3000);
      const g = KIND_GROUPS.find((k) => k.label === group);
      if (g) q = q.in('kind', g.kinds);
      if (user) q = q.eq('created_by', user);
      if (item) q = q.ilike('description', `%${item}%`);
      if (status) q = q.eq('status', status);
      if (minAmt) q = q.gte('amount', Number(minAmt));
      if (maxAmt) q = q.lte('amount', Number(maxAmt));
      return unwrap(await q) as LedgerRow[];
    },
  });
  const active = Object.values(filters).some(Boolean);
  const report = (): OfficialReport => ({
    title: 'Transaction History',
    period: describePeriod(period.start, period.end),
    schoolYear: activeSchoolYear?.name,
    filename: `QNHS-Transactions-${period.start}_${period.end}`,
    orientation: 'landscape',
    columns: [
      { key: 'ref_no', header: 'Reference', width: 14 },
      { key: 'txn_date', header: 'Date', format: 'date', width: 13 },
      { key: 'kind_label', header: 'Type', width: 18 },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'quantity', header: 'Qty', format: 'qty', width: 9 },
      { key: 'amount', header: 'Amount', format: 'peso', width: 14 },
      { key: 'created_by_name', header: 'Recorded By', width: 18 },
      { key: 'status', header: 'Status', width: 10 },
    ],
    rows: data.map((r) => ({ ...r, kind_label: LEDGER_KIND_LABEL[r.kind] ?? r.kind })),
  });
  return (
    <>
      <Card className="no-print">
        <FilterBar
          active={active}
          onClear={() => {
            setGroup('');
            setUser('');
            setItem('');
            setStatus('');
            setMinAmt('');
            setMaxAmt('');
          }}
        >
          <FilterField label="Transaction type">
            <Select value={group} onChange={(e) => { setGroup(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              {KIND_GROUPS.map((g) => (
                <option key={g.label}>{g.label}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="User">
            <Select value={user} onChange={(e) => { setUser(e.target.value); setPage(1); }}>
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Item / description">
            <Input value={item} onChange={(e) => { setItem(e.target.value); setPage(1); }} />
          </FilterField>
          <FilterField label="Amount from" className="min-w-[110px]">
            <Input type="number" min={0} value={minAmt} onChange={(e) => setMinAmt(e.target.value)} />
          </FilterField>
          <FilterField label="to" className="min-w-[110px]">
            <Input type="number" min={0} value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} />
          </FilterField>
          <FilterField label="Status" className="min-w-[120px]">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="posted">Posted</option>
              <option value="finalized">Finalized</option>
              <option value="draft">Draft</option>
              <option value="reversed">Reversed</option>
              <option value="exception">Exception</option>
            </Select>
          </FilterField>
          <div className="ml-auto self-end">
            <ExportMenu report={report} disabled={data.length === 0} />
          </div>
        </FilterBar>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : data.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight />} title="No transactions match" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Reference</TH>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Description</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Amount</TH>
                  <TH>Recorded by</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {data.slice((page - 1) * PAGE, page * PAGE).map((r) => (
                  <TR key={r.kind + r.id} onClick={() => r.link && navigate(r.link)}>
                    <TD className="font-mono text-xs text-ink-muted">{r.ref_no}</TD>
                    <TD className="whitespace-nowrap">{formatDate(r.txn_date)}</TD>
                    <TD className="whitespace-nowrap">{LEDGER_KIND_LABEL[r.kind] ?? titleCase(r.kind)}</TD>
                    <TD className="max-w-[380px] truncate">{r.description}</TD>
                    <TD align="right">{r.quantity === null ? '—' : qty(r.quantity)}</TD>
                    <TD align="right" className="font-medium">{r.amount === null ? '—' : peso(r.amount)}</TD>
                    <TD className="whitespace-nowrap text-ink-muted">{r.created_by_name ?? '—'}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={data.length} onPage={setPage} />
          </>
        )}
      </Card>
      <PrintableReport report={data.length ? report() : null} />
    </>
  );
}

function Audit({ period }: { period: Period }) {
  const { data: users = [] } = useUsers();
  const [user, setUser] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['audit', period.start, period.end, user, entity, action],
    queryFn: async () => {
      let q = supabase
        .from('audit_logs')
        .select('*')
        .gte('created_at', `${period.start}T00:00:00+08:00`)
        .lte('created_at', `${period.end}T23:59:59+08:00`)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (user) q = q.eq('user_id', user);
      if (entity) q = q.eq('entity_type', entity);
      if (action) q = q.ilike('action', `%${action}%`);
      return unwrap(await q) as AuditLog[];
    },
  });
  const entities = ['financial_transactions', 'daily_sales', 'inventory_items', 'stock_receipts', 'fund_transactions', 'fund_allocation_runs', 'allocation_rules', 'allocation_rule_lines', 'cash_carryovers', 'profiles', 'user_permissions', 'school_settings', 'import_batches'];
  return (
    <Card>
      <FilterBar active={Boolean(user || entity || action)} onClear={() => { setUser(''); setEntity(''); setAction(''); }}>
        <FilterField label="User">
          <Select value={user} onChange={(e) => { setUser(e.target.value); setPage(1); }}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Record type">
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {entities.map((e) => (
              <option key={e} value={e}>{titleCase(e)}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Action">
          <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="e.g. finalize, update" />
        </FilterField>
      </FilterBar>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton />
      ) : data.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No audit entries for this period" />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>User</TH>
                <TH>Action</TH>
                <TH>Record</TH>
                <TH>Changes</TH>
              </tr>
            </THead>
            <tbody>
              {data.slice((page - 1) * PAGE, page * PAGE).map((a) => (
                <TR key={a.id} className="align-top">
                  <TD className="whitespace-nowrap text-xs text-ink-muted">{formatDateTime(a.created_at)}</TD>
                  <TD className="whitespace-nowrap">{a.user_name ?? 'system'}</TD>
                  <TD className="whitespace-nowrap font-medium">{titleCase(a.action)}</TD>
                  <TD className="text-xs">
                    <div>{titleCase(a.entity_type)}</div>
                    <div className="font-mono text-[10px] text-ink-muted">{a.entity_id?.slice(0, 8)}</div>
                  </TD>
                  <TD className="max-w-[460px]">
                    {a.context && <div className="text-xs italic text-ink-muted">“{a.context}”</div>}
                    {a.action === 'update' ? (
                      <ChangeList oldV={a.old_values} newV={a.new_values} />
                    ) : (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-ink-muted">Details</summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-page p-2 text-[10px]">{JSON.stringify(a.new_values ?? a.old_values, null, 1)}</pre>
                      </details>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE} total={data.length} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
