import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, GitCompare, XCircle } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { formatDate, peso, toNumber } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/providers/auth';

interface ReconRow {
  report_date: string;
  source_ref: string | null;
  wb_daily_canteen_shares: string;
  sys_daily_canteen_shares: string;
  wb_other_shares: string;
  sys_other_shares: string;
  wb_expenses: string;
  sys_expenses: string;
  wb_deficit: string;
  sys_deficit: string;
  wb_net_sales: string;
  sys_net_sales: string;
  matches: boolean;
}

function Pair({ wb, sys }: { wb: string; sys: string }) {
  const same = toNumber(wb) === toNumber(sys);
  return (
    <TD align="right">
      <div className={same ? '' : 'font-semibold text-danger-600'}>{peso(sys)}</div>
      {!same && <div className="text-[11px] text-ink-muted">workbook {peso(wb)}</div>}
    </TD>
  );
}

/** Compares SUMMARY figures imported from the workbook with recalculated totals. */
export function ReconciliationReport() {
  const { can } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ['reports', 'reconciliation'],
    queryFn: () => rpc<ReconRow[]>('report_import_reconciliation'),
  });
  const mismatches = data.filter((r) => !r.matches).length;
  return (
    <Card>
      <CardHeader
        title="Workbook reconciliation"
        description="SUMMARY-sheet figures imported from CANTEEN REPORT.xlsx versus totals recalculated from the imported underlying records."
        icon={<GitCompare />}
        actions={
          can('import.run') && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/settings/import">Excel import</Link>
            </Button>
          )
        }
      />
      {isLoading ? (
        <TableSkeleton />
      ) : data.length === 0 ? (
        <EmptyState icon={<GitCompare />} title="No workbook figures imported" description="Import the SUMMARY sheet in Settings → Excel import to compare it with the system's recalculated totals." />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-surface-border px-5 py-3 text-sm">
            {mismatches === 0 ? (
              <>
                <CheckCircle2 className="size-4 text-brand-600" /> All {data.length} dates reconcile.
              </>
            ) : (
              <>
                <XCircle className="size-4 text-danger-600" /> {mismatches} of {data.length} dates differ — review the highlighted values (system value shown, workbook value below).
              </>
            )}
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Source</TH>
                <TH align="right">Canteen shares</TH>
                <TH align="right">Other shares</TH>
                <TH align="right">Expenses</TH>
                <TH align="right">Deficit</TH>
                <TH align="right">Net sales</TH>
                <TH>Result</TH>
              </tr>
            </THead>
            <tbody>
              {data.map((r) => (
                <TR key={r.report_date}>
                  <TD className="whitespace-nowrap font-medium">{formatDate(r.report_date)}</TD>
                  <TD className="font-mono text-xs text-ink-muted">{r.source_ref}</TD>
                  <Pair wb={r.wb_daily_canteen_shares} sys={r.sys_daily_canteen_shares} />
                  <Pair wb={r.wb_other_shares} sys={r.sys_other_shares} />
                  <Pair wb={r.wb_expenses} sys={r.sys_expenses} />
                  <Pair wb={r.wb_deficit} sys={r.sys_deficit} />
                  <Pair wb={r.wb_net_sales} sys={r.sys_net_sales} />
                  <TD>{r.matches ? <CheckCircle2 className="size-4 text-brand-600" /> : <XCircle className="size-4 text-danger-600" />}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  );
}
