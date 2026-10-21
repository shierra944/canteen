import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, FileSpreadsheet, Loader2, RefreshCw, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { FINANCIAL_KEYS, keys, useInvalidate } from '@/lib/queries';
import { loadWorkbook, worksheetToGrid } from '@/lib/import/excel-grid';
import {
  buildBlockDateLookup,
  deriveProductList,
  detectSheetKind,
  parseDailySales,
  parseExpensesAndOtherSales,
  parseSummary,
  type Grid,
  type ParseResult,
} from '@/lib/import/workbook';
import { cn, formatDateTime } from '@/lib/utils';
import type { ImportBatch } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/feedback';

type StepState = 'waiting' | 'running' | 'done' | 'skipped' | 'error';
interface Step {
  key: string;
  label: string;
  state: StepState;
  added: number;
  existing: number;
  review: number;
  note?: string;
  batchId?: string;
}

const STEPS: Pick<Step, 'key' | 'label'>[] = [
  { key: 'products', label: 'Products & consignees (DAILY SALES sheet)' },
  { key: 'daily_sales', label: 'Past daily sales (DAILY SALES sheet)' },
  { key: 'expenses', label: 'Expenses, other sales & deficits (EXPENSES & OTHER SALES sheet)' },
  { key: 'summary', label: 'Summary figures for reconciliation (SUMMARY sheet)' },
  { key: 'carryovers', label: 'Cash carry-overs (SUMMARY sheet)' },
];

/**
 * One-click migration / sync from the school's workbook. Safe to repeat:
 * products, days and transactions already in the app are skipped, so
 * uploading the latest spreadsheet only adds what is new.
 */
export function SyncPanel() {
  const invalidate = useInvalidate();
  const [file, setFile] = useState<File | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const lastSync = useQuery({
    queryKey: ['imports', 'last'],
    queryFn: async () => unwrap(await supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(1)) as ImportBatch[],
  });

  const update = (key: string, patch: Partial<Step>) => setSteps((ss) => ss && ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  /** Stage rows, commit valid ones, report counts. Review rows stay open. */
  async function stageAndCommit(result: ParseResult, sheet: string, fileName: string) {
    const rows = result.rows.filter((r) => r.status !== 'skipped');
    if (rows.length === 0) return { added: 0, existing: 0, review: 0, batchId: undefined };
    const batchId = await rpc<string>('stage_import', { p_batch: { file_name: fileName, sheet_name: sheet, target: result.target, notes: 'Spreadsheet sync' }, p_rows: rows });
    await rpc('sync_commit_import_batch', { p_batch_id: batchId });
    const after = unwrap(await supabase.from('import_rows').select('status, group_key').eq('batch_id', batchId)) as { status: string; group_key: string | null }[];
    const count = (st: string) => after.filter((r) => r.status === st).length;
    if (result.target === 'daily_sales') {
      // report whole days for daily sales
      const days = (st: string) => new Set(after.filter((r) => r.status === st).map((r) => r.group_key)).size;
      return { added: days('imported'), existing: days('duplicate'), review: new Set(after.filter((r) => r.status === 'review' || r.status === 'invalid' || r.status === 'valid').map((r) => r.group_key)).size, batchId };
    }
    return { added: count('imported'), existing: count('duplicate'), review: count('review') + count('invalid'), batchId };
  }

  async function sync() {
    if (!file) return;
    setRunning(true);
    setSteps(STEPS.map((s) => ({ ...s, state: 'waiting', added: 0, existing: 0, review: 0 })));
    try {
      const wb = await loadWorkbook(await file.arrayBuffer());
      const grids = wb.worksheets.map(worksheetToGrid);
      const find = (kind: ReturnType<typeof detectSheetKind>) => grids.find((g) => detectSheetKind(g) === kind) ?? null;
      const daily: Grid | null = find('daily_sales');
      const expenses: Grid | null = find('expenses');
      const summary: Grid | null = find('summary');
      const dailyParsed = daily ? parseDailySales(daily) : null;
      const expParsed = expenses ? parseExpensesAndOtherSales(expenses) : null;

      const run = async (key: string, enabled: boolean, missing: string, fn: () => Promise<Partial<Step>>) => {
        if (!enabled) return update(key, { state: 'skipped', note: missing });
        update(key, { state: 'running' });
        try {
          update(key, { state: 'done', ...(await fn()) });
        } catch (e) {
          update(key, { state: 'error', note: (e as Error).message });
        }
      };

      await run('products', Boolean(dailyParsed), 'No DAILY SALES sheet found.', async () => {
        const products = deriveProductList(dailyParsed!).filter((p) => !p.possibleDuplicateOf);
        const r = await rpc<{ created: number; skipped: number; new_consignees: number }>('import_products', {
          p_rows: products.map((p) => ({ name: p.name, consignee: p.consignee, selling_price: p.selling_price, is_consigned: Boolean(p.consignee) })),
        });
        return { added: r.created, existing: r.skipped, note: r.new_consignees ? `${r.new_consignees} new consignees` : undefined };
      });
      await run('daily_sales', Boolean(dailyParsed), 'No DAILY SALES sheet found.', async () => {
        const r = await stageAndCommit(dailyParsed!, daily!.name, file.name);
        return { ...r, note: 'counted in days' };
      });
      await run('expenses', Boolean(expParsed), 'No EXPENSES & OTHER SALES sheet found.', () => stageAndCommit(expParsed!, expenses!.name, file.name));
      const parsedSummary = summary ? parseSummary(summary, buildBlockDateLookup(dailyParsed, expParsed)) : null;
      await run('summary', Boolean(parsedSummary), 'No SUMMARY sheet found.', () => stageAndCommit(parsedSummary!.references, summary!.name, file.name));
      await run('carryovers', Boolean(parsedSummary?.carryovers.rows.length), 'No cash carry-overs found.', async () => {
        // carry-overs have no date in the workbook: stage them for review only
        const rows = parsedSummary!.carryovers.rows;
        const batchId = await rpc<string>('stage_import', { p_batch: { file_name: file.name, sheet_name: summary!.name, target: 'cash_carryovers', notes: 'Spreadsheet sync' }, p_rows: rows });
        const after = unwrap(await supabase.from('import_rows').select('status').eq('batch_id', batchId)) as { status: string }[];
        return { added: 0, existing: after.filter((r) => r.status === 'duplicate').length, review: after.filter((r) => r.status === 'review').length, batchId, note: 'need a date before import' };
      });
      await invalidate([...FINANCIAL_KEYS, keys.consignees, ['imports']]);
      toast.success('Sync finished.');
    } catch (e) {
      toast.error(`Could not read the workbook: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  const last = lastSync.data?.[0];
  return (
    <Card className="mb-6">
      <CardHeader
        title="Sync from your spreadsheet"
        description="Upload CANTEEN REPORT.xlsx to bring your existing records into the app. You can upload the updated spreadsheet again anytime — only new products, days and entries are added."
        icon={<RefreshCw />}
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm hover:border-brand-500 hover:bg-brand-50/40', file ? 'border-brand-500 bg-brand-50/40' : 'border-surface-border')}>
            {file ? <FileSpreadsheet className="size-4 text-brand-600" /> : <Upload className="size-4 text-brand-600" />}
            <span className="font-medium">{file ? file.name : 'Choose the spreadsheet (.xlsx)'}</span>
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && !/\.xlsx$/i.test(f.name)) return toast.error('Choose an .xlsx file.');
                setFile(f);
                setSteps(null);
              }}
            />
          </label>
          <Button onClick={() => void sync()} disabled={!file || running} loading={running}>
            <RefreshCw /> {steps ? 'Sync again' : 'Sync now'}
          </Button>
          {last && <span className="text-xs text-ink-muted">Last import: {formatDateTime(last.created_at)} · {last.file_name}</span>}
        </div>

        {steps && (
          <ol className="divide-y divide-surface-border rounded-xl border border-surface-border">
            {steps.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StepIcon state={s.state} />
                <span className="min-w-[260px] flex-1 text-sm font-medium">{s.label}</span>
                {s.state === 'done' && (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">{s.added} added</span>
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-ink-muted">{s.existing} already in the app</span>
                    {s.review > 0 && (
                      <Link to={`/settings/import?batch=${s.batchId}`} className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 font-medium text-gold-600 hover:underline">
                        <AlertTriangle className="size-3" /> {s.review} need review
                      </Link>
                    )}
                    {s.note && <span className="text-ink-muted">· {s.note}</span>}
                  </span>
                )}
                {(s.state === 'skipped' || s.state === 'error') && <span className={cn('text-xs', s.state === 'error' ? 'text-danger-600' : 'text-ink-muted')}>{s.note}</span>}
              </li>
            ))}
          </ol>
        )}

        <Callout tone="info" title="How the sync works">
          <ul className="list-disc space-y-1 pl-4">
            <li>Products are created from the DAILY SALES sheet as consigned items with their latest selling price. Likely typos (e.g. “Biscutis”) are left out.</li>
            <li>Past days are imported as finalized records for the reports; they never change current inventory. Days with an error (such as sold more than the total) are held for review.</li>
            <li>Excel formulas are not copied — totals are recalculated, and the SUMMARY figures are only used to check them (Reports → Workbook Reconciliation).</li>
            <li>Running it again skips everything already imported. If you change a day that was already imported, correct it in the app instead.</li>
          </ul>
        </Callout>
      </CardBody>
    </Card>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') return <Loader2 className="size-4 animate-spin text-brand-600" />;
  if (state === 'done') return <CheckCircle2 className="size-4 text-brand-600" />;
  if (state === 'error') return <XCircle className="size-4 text-danger-600" />;
  if (state === 'skipped') return <CircleDashed className="size-4 text-ink-soft" />;
  return <CircleDashed className="size-4 text-ink-muted" />;
}
