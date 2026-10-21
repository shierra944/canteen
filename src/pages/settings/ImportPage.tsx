import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Workbook } from 'exceljs';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, Pencil, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { rpc, supabase, unwrap } from '@/lib/supabase';
import { FINANCIAL_KEYS, useInvalidate } from '@/lib/queries';
import { loadWorkbook, worksheetToGrid } from '@/lib/import/excel-grid';
import {
  buildBlockDateLookup,
  colLetter,
  deriveProductList,
  detectSheetKind,
  parseDailySales,
  parseExpensesAndOtherSales,
  parseGenericTransactions,
  parseSummary,
  type DerivedProduct,
  type GenericMapping,
  type Grid,
  type ParseResult,
  type StagedRow,
} from '@/lib/import/workbook';
import { cn, formatDate, formatDateTime, peso, titleCase } from '@/lib/utils';
import type { ImportBatch, ImportRow } from '@/lib/types';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Callout, EmptyState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TD, TH, THead, TR } from '@/components/ui/table';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { ProductListBuilder } from './ProductListBuilder';

const TARGET_LABEL: Record<string, string> = {
  daily_sales: 'Daily sales records',
  financial_transactions: 'Expenses & other sales',
  summary_reference: 'SUMMARY figures (reconciliation only)',
  cash_carryovers: 'Cash carry-overs',
};

const STEPS = ['Upload', 'Select sheet', 'Preview & map', 'Validate', 'Review', 'Import'];

export default function ImportPage() {
  const [params, setParams] = useSearchParams();
  const batchId = params.get('batch');
  return (
    <>
      <Link to="/settings?tab=import" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageHeader title="Excel import & data migration" description="Historical records are staged, validated and reviewed before anything is imported. Formulas are never imported as values." />
      {batchId ? <BatchReview batchId={batchId} onDone={() => setParams({})} /> : <Wizard onStaged={(ids) => setParams({ batch: ids[0] })} />}
      {!batchId && <BatchHistory onOpen={(id) => setParams({ batch: id })} />}
    </>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn('flex size-6 items-center justify-center rounded-full font-semibold', i < step ? 'bg-brand-600 text-white' : i === step ? 'bg-gold-400 text-ink' : 'bg-surface-sunken text-ink-muted')}>{i + 1}</span>
          <span className={cn(i === step ? 'font-semibold text-ink' : 'text-ink-muted')}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-surface-border" />}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------- wizard
function Wizard({ onStaged }: { onStaged: (batchIds: string[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [wb, setWb] = useState<Workbook | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState('');
  const [results, setResults] = useState<ParseResult[] | null>(null);
  const [products, setProducts] = useState<DerivedProduct[] | null>(null);
  const [mapping, setMapping] = useState<GenericMapping>({ headerRow: 1 });
  const [staging, setStaging] = useState(false);
  const step = !wb ? 0 : !sheet ? 1 : !results ? 2 : 3;

  async function onFile(f: File) {
    if (!/\.xlsx$/i.test(f.name)) return toast.error('Choose an .xlsx workbook.');
    if (f.size > 25 * 1024 * 1024) return toast.error('File is larger than 25 MB.');
    setLoading(true);
    try {
      const book = await loadWorkbook(await f.arrayBuffer());
      setFile(f);
      setWb(book);
      setSheet('');
      setResults(null);
    } catch (e) {
      toast.error(`Could not read the workbook: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const grids = useMemo(() => new Map((wb?.worksheets ?? []).map((ws) => [ws.name, worksheetToGrid(ws)])), [wb]);
  const grid = sheet ? grids.get(sheet) ?? null : null;
  const kind = grid ? detectSheetKind(grid) : null;

  function parse() {
    if (!grid || !kind) return;
    try {
      if (kind === 'daily_sales') setResults([parseDailySales(grid)]);
      else if (kind === 'expenses') setResults([parseExpensesAndOtherSales(grid)]);
      else if (kind === 'summary') {
        const daily = [...grids.values()].find((g) => detectSheetKind(g) === 'daily_sales');
        const exp = [...grids.values()].find((g) => detectSheetKind(g) === 'expenses');
        const lookup = buildBlockDateLookup(daily ? parseDailySales(daily) : null, exp ? parseExpensesAndOtherSales(exp) : null);
        const { references, carryovers } = parseSummary(grid, lookup);
        setResults([references, carryovers].filter((r) => r.rows.length > 0 || r.warnings.length > 0));
      } else if (kind === 'generic') setResults([parseGenericTransactions(grid, mapping)]);
    } catch (e) {
      toast.error(`Could not parse the sheet: ${(e as Error).message}`);
    }
  }

  async function stage() {
    if (!results || !file) return;
    setStaging(true);
    try {
      const ids: string[] = [];
      for (const r of results) {
        if (r.rows.length === 0) continue;
        ids.push(
          await rpc<string>('stage_import', {
            p_batch: { file_name: file.name, sheet_name: sheet, target: r.target },
            p_rows: r.rows,
          }),
        );
      }
      if (ids.length === 0) return toast.info('Nothing to stage.');
      toast.success('Rows staged for review. Duplicates were checked against existing records.');
      onStaged(ids);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStaging(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardBody>
        <Stepper step={step} />
        {step === 0 && (
          <label className={cn('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-surface-border bg-surface-page px-6 py-14 text-center hover:border-brand-500', loading && 'pointer-events-none opacity-60')}>
            {loading ? <Loader2 className="size-8 animate-spin text-brand-600" /> : <Upload className="size-8 text-brand-600" />}
            <div className="mt-3 text-sm font-semibold">{loading ? 'Reading workbook…' : 'Upload CANTEEN REPORT.xlsx'}</div>
            <div className="mt-1 text-xs text-ink-muted">The file is read in your browser; only the validated rows are sent to the database.</div>
            <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
        )}

        {step >= 1 && wb && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <FileSpreadsheet className="size-4 text-brand-600" />
              <span className="font-medium">{file?.name}</span>
              <Button variant="link" size="sm" onClick={() => { setWb(null); setFile(null); setSheet(''); setResults(null); }}>Choose another file</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {wb.worksheets.map((ws) => {
                const k = detectSheetKind(grids.get(ws.name)!);
                return (
                  <button
                    key={ws.id}
                    onClick={() => { setSheet(ws.name); setResults(null); setProducts(null); }}
                    className={cn('rounded-xl border p-3 text-left transition-colors', sheet === ws.name ? 'border-brand-500 bg-brand-50' : 'border-surface-border hover:bg-surface-page')}
                  >
                    <div className="text-sm font-semibold">{ws.name}</div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {k === 'daily_sales' ? 'Daily sales blocks' : k === 'expenses' ? 'Expenses & other sales blocks' : k === 'summary' ? 'Consolidated summary' : k === 'funds' ? 'Fund list (not used)' : 'Generic table — map columns'}
                      {ws.state !== 'visible' && ' · hidden'}
                    </div>
                  </button>
                );
              })}
            </div>

            {grid && kind === 'funds' && (
              <Callout tone="info" title="Nothing to import from this sheet">
                It only lists fund types ({Array.from({ length: grid.rowCount }, (_, i) => grid.value(i + 1, 1)).filter(Boolean).join(' · ')}). Fund allocation is not used in this app.
              </Callout>
            )}
            {grid && kind === 'generic' && <GenericMapper grid={grid} mapping={mapping} onChange={setMapping} />}
            {grid && kind === 'daily_sales' && !results && !products && (
              <div className="grid gap-3 md:grid-cols-2">
                <button onClick={() => setProducts(deriveProductList(parseDailySales(grid)))} className="rounded-xl border border-surface-border p-4 text-left hover:border-brand-500 hover:bg-brand-50/40">
                  <div className="text-sm font-semibold">1. Create product list</div>
                  <div className="mt-1 text-xs leading-relaxed text-ink-muted">Build Inventory from the items, consignees and selling prices in this sheet. Do this first.</div>
                </button>
                <button onClick={parse} className="rounded-xl border border-surface-border p-4 text-left hover:border-brand-500 hover:bg-brand-50/40">
                  <div className="text-sm font-semibold">2. Import historical daily sales</div>
                  <div className="mt-1 text-xs leading-relaxed text-ink-muted">Bring in each day's sold quantities as finalized records for the reports. Inventory is not changed.</div>
                </button>
              </div>
            )}
            {grid && kind === 'daily_sales' && products && (
              <>
                <Button variant="link" size="sm" onClick={() => setProducts(null)}>
                  ← Back to import options
                </Button>
                <ProductListBuilder products={products} />
              </>
            )}
            {grid && kind !== 'funds' && kind !== 'daily_sales' && !results && (
              <Button onClick={parse}>Preview & validate</Button>
            )}
            {results && (
              <ParsePreview
                results={results}
                onChange={(i, rows) => setResults((rs) => rs!.map((r, j) => (j === i ? { ...r, rows } : r)))}
                onStage={() => void stage()}
                staging={staging}
              />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function GenericMapper({ grid, mapping, onChange }: { grid: Grid; mapping: GenericMapping; onChange: (m: GenericMapping) => void }) {
  const cols = Array.from({ length: Math.min(grid.colCount, 40) }, (_, i) => i + 1);
  const header = (c: number) => String(grid.value(mapping.headerRow, c) ?? '').trim();
  const sel = (key: keyof GenericMapping, label: string) => (
    <Field label={label}>
      <Select value={String(mapping[key] ?? '')} onChange={(e) => onChange({ ...mapping, [key]: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">— not mapped —</option>
        {cols.map((c) => (
          <option key={c} value={c}>
            {colLetter(c)}{header(c) ? ` — ${header(c)}` : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="space-y-4 rounded-xl border border-surface-border p-4">
      <div className="text-sm font-semibold">Map spreadsheet columns</div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Header row">
          <Input type="number" min={1} value={mapping.headerRow} onChange={(e) => onChange({ ...mapping, headerRow: Math.max(1, Number(e.target.value)) })} />
        </Field>
        {sel('date', 'Date column')}
        {sel('description', 'Item / description column')}
        {sel('type', 'Nature of item (type) column')}
        {sel('requestedBy', 'Requested / given by column')}
        {sel('amount', 'Amount column')}
        <Field label="Fixed type (if no type column)">
          <Select value={mapping.fixedType ?? ''} onChange={(e) => onChange({ ...mapping, fixedType: (e.target.value || undefined) as GenericMapping['fixedType'] })}>
            <option value="">—</option>
            <option value="sale">Sale</option>
            <option value="expense">Expense</option>
            <option value="deficit">Deficit</option>
          </Select>
        </Field>
        <Field label="Fixed date (if no date column)">
          <Input type="date" value={mapping.fixedDate ?? ''} onChange={(e) => onChange({ ...mapping, fixedDate: e.target.value || undefined })} />
        </Field>
      </div>
    </div>
  );
}

function ParsePreview({ results, onChange, onStage, staging }: { results: ParseResult[]; onChange: (i: number, rows: StagedRow[]) => void; onStage: () => void; staging: boolean }) {
  const all = results.flatMap((r) => r.rows);
  const count = (s: string) => all.filter((r) => r.status === s).length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Valid', count('valid'), 'text-brand-700'],
          ['Needs review', count('review'), 'text-warn-700'],
          ['Invalid', count('invalid'), 'text-danger-600'],
          ['Skipped (blank / zero)', count('skipped'), 'text-ink-muted'],
        ].map(([l, n, c]) => (
          <div key={l as string} className="rounded-xl border border-surface-border p-3">
            <div className="text-xs text-ink-muted">{l}</div>
            <div className={cn('tabular text-xl font-semibold', c as string)}>{n}</div>
          </div>
        ))}
      </div>
      {results.map((r, ri) => (
        <div key={r.target} className="space-y-3">
          <div className="text-sm font-semibold">{TARGET_LABEL[r.target]} — {r.rows.length} rows</div>
          {r.warnings.map((w) => <Callout key={w} tone="warning">{w}</Callout>)}
          {r.blocks.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-surface-border">
              <Table>
                <THead>
                  <tr>
                    <TH>Block</TH>
                    <TH>Date</TH>
                    <TH align="right">Rows</TH>
                    <TH>Workbook total vs recalculated</TH>
                  </tr>
                </THead>
                <tbody>
                  {r.blocks.map((b) => (
                    <TR key={b.anchor}>
                      <TD className="font-mono text-xs">{b.anchor}</TD>
                      <TD>{b.date ? formatDate(b.date, 'long') : <Badge tone="amber">No date</Badge>}</TD>
                      <TD align="right">{b.rowCount}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {b.checks.map((c) => (
                            <span key={c.label} className={cn('inline-flex items-center gap-1', c.ok ? 'text-brand-700' : 'text-danger-600')}>
                              {c.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                              {c.label}: {c.workbook ?? '—'} / {c.recalculated}
                            </span>
                          ))}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <RowsTable rows={r.rows} target={r.target} onToggle={(idx, status) => onChange(ri, r.rows.map((x, j) => (j === idx ? { ...x, status } : x)))} />
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-page p-4">
        <p className="text-sm text-ink-muted">Staging saves these rows in a review area. Nothing is added to the records until you import the reviewed batch.</p>
        <Button onClick={onStage} loading={staging} disabled={all.length === 0}>Stage for review</Button>
      </div>
    </div>
  );
}

function summarize(target: string, m: Record<string, unknown>): string {
  const n = (k: string) => (m[k] === null || m[k] === undefined ? '—' : String(m[k]));
  switch (target) {
    case 'daily_sales':
      return `${n('sale_date')} · ${n('item_name')} · ${n('consignee')} · total ${n('total_quantity')} · ₱${n('unit_price')} · sold ${n('sold_quantity')} · share ${n('share_quantity')}`;
    case 'financial_transactions':
      return `${n('transaction_date')} · ${n('transaction_type')} · ${n('description')} · ${n('requested_by')} · ${m.amount === null ? '—' : peso(m.amount)}${m.category ? ` · ${m.category}` : ''}`;
    case 'cash_carryovers':
      return `${n('entry_date')} · ${n('description')} · ${peso(m.amount)}`;
    default:
      return `${n('report_date')} · actual ${n('actual_money')} · shares ${n('daily_canteen_shares')} · other ${n('other_shares')} · exp ${n('expenses')} · def ${n('deficit')} · net ${n('net_sales')}`;
  }
}

function RowsTable({ rows, target, onToggle }: { rows: StagedRow[]; target: string; onToggle: (i: number, s: StagedRow['status']) => void }) {
  const [filter, setFilter] = useState<'all' | 'issues'>('issues');
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter === 'all' || r.status !== 'valid' || r.messages.length > 0);
  return (
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <div className="flex items-center gap-2 border-b border-surface-border px-4 py-2 text-xs">
        <button onClick={() => setFilter('issues')} className={cn('rounded px-2 py-1', filter === 'issues' ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-muted')}>Rows with notes ({rows.filter((r) => r.status !== 'valid' || r.messages.length).length})</button>
        <button onClick={() => setFilter('all')} className={cn('rounded px-2 py-1', filter === 'all' ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-muted')}>All rows ({rows.length})</button>
      </div>
      <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
        <Table>
          <THead>
            <tr>
              <TH>Cell</TH>
              <TH>Data</TH>
              <TH>Status</TH>
              <TH>Notes</TH>
            </tr>
          </THead>
          <tbody>
            {shown.slice(0, 400).map(({ r, i }) => (
              <TR key={r.row_ref + i}>
                <TD className="whitespace-nowrap font-mono text-xs">{r.row_ref.split('!')[1]}</TD>
                <TD className="max-w-[420px] text-xs">{summarize(target, r.mapped)}</TD>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={r.status} />
                    {r.status === 'skipped' && <button className="text-xs text-brand-600 hover:underline" onClick={() => onToggle(i, 'valid')}>Include</button>}
                    {r.status === 'valid' && <button className="text-xs text-ink-muted hover:underline" onClick={() => onToggle(i, 'skipped')}>Skip</button>}
                  </div>
                </TD>
                <TD className="max-w-[360px] text-xs text-ink-muted">{r.messages.join(' ')}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
        {shown.length === 0 && <div className="py-8 text-center text-sm text-ink-muted">No issues found.</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------- batch review
const EDIT_FIELDS: Record<string, { key: string; label: string; type: 'text' | 'number' | 'date' | 'type' }[]> = {
  daily_sales: [
    { key: 'sale_date', label: 'Sale date', type: 'date' },
    { key: 'item_name', label: 'Item', type: 'text' },
    { key: 'consignee', label: 'Consignee', type: 'text' },
    { key: 'total_quantity', label: 'Total quantity', type: 'number' },
    { key: 'unit_price', label: 'Price per piece', type: 'number' },
    { key: 'sold_quantity', label: 'Sold quantity', type: 'number' },
    { key: 'share_quantity', label: 'Share', type: 'number' },
  ],
  financial_transactions: [
    { key: 'transaction_date', label: 'Date', type: 'date' },
    { key: 'transaction_type', label: 'Type', type: 'type' },
    { key: 'description', label: 'Item / description', type: 'text' },
    { key: 'requested_by', label: 'Requested / given by', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number' },
  ],
  cash_carryovers: [
    { key: 'entry_date', label: 'Date', type: 'date' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number' },
  ],
  summary_reference: [{ key: 'report_date', label: 'Report date', type: 'date' }],
};

function BatchReview({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['imports', batchId],
    queryFn: async () => {
      const [b, r] = await Promise.all([
        supabase.from('import_batches').select('*').eq('id', batchId).single(),
        supabase.from('import_rows').select('*').eq('batch_id', batchId).order('row_ref'),
      ]);
      return { batch: unwrap(b) as ImportBatch, rows: unwrap(r) as ImportRow[] };
    },
  });
  const [edit, setEdit] = useState<ImportRow | null>(null);
  const [confirm, setConfirm] = useState<'commit' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [filter, setFilter] = useState('');

  if (isLoading || !data) return <Card className="mb-6"><TableSkeleton /></Card>;
  const { batch, rows } = data;
  const counts = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const staged = batch.status === 'staged';
  const shown = rows.filter((r) => !filter || r.status === filter);

  async function act(kind: 'commit' | 'cancel') {
    setBusy(true);
    try {
      if (kind === 'commit') {
        const res = await rpc<Record<string, number>>('sync_commit_import_batch', { p_batch_id: batchId });
        setResult(res);
        await invalidate(FINANCIAL_KEYS);
        toast.success('Import completed.');
      } else {
        await rpc('cancel_import_batch', { p_batch_id: batchId });
        toast.success('Batch cancelled. Nothing was imported.');
      }
      setConfirm(null);
      await qc.invalidateQueries({ queryKey: ['imports'] });
      await refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title={`${batch.file_name} — ${batch.sheet_name}`}
        description={`${TARGET_LABEL[batch.target] ?? batch.target} · staged ${formatDateTime(batch.created_at)}`}
        actions={
          <>
            <StatusBadge status={batch.status} />
            {staged && (
              <>
                <Button variant="ghost" onClick={() => setConfirm('cancel')}>Cancel batch</Button>
                <Button onClick={() => setConfirm('commit')} disabled={!counts.valid}>Import {counts.valid ?? 0} valid rows</Button>
              </>
            )}
            {!staged && <Button variant="secondary" onClick={onDone}>New import</Button>}
          </>
        }
      />
      <CardBody className="space-y-4">
        <Stepper step={staged ? 4 : 6} />
        {result && (
          <Callout tone="info" title="Import summary">
            {Object.entries(result).map(([k, v]) => `${titleCase(k)}: ${v}`).join(' · ')}. Rows that failed keep their error message below; reports are recalculated from the imported records.
          </Callout>
        )}
        {batch.target === 'daily_sales' && staged && (
          <Callout tone="info">Imported daily sales are saved as finalized historical records. They do <b>not</b> change current inventory quantities. A day is imported only when all of its rows are valid.</Callout>
        )}
        {batch.target === 'summary_reference' && staged && (
          <Callout tone="info">SUMMARY figures are kept for reconciliation only (Reports → Workbook Reconciliation). Actual Money is attached to the matching daily sales record.</Callout>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={() => setFilter('')} className={cn('rounded-lg border px-2.5 py-1', !filter ? 'border-brand-500 bg-brand-50' : 'border-surface-border')}>All {rows.length}</button>
          {Object.entries(counts).map(([s, n]) => (
            <button key={s} onClick={() => setFilter(s)} className={cn('rounded-lg border px-2.5 py-1', filter === s ? 'border-brand-500 bg-brand-50' : 'border-surface-border')}>
              {titleCase(s)} {n}
            </button>
          ))}
        </div>
      </CardBody>
      <div className="scrollbar-thin max-h-[560px] overflow-y-auto border-t border-surface-border">
        <Table>
          <THead>
            <tr>
              <TH>Cell</TH>
              <TH>Data</TH>
              <TH>Status</TH>
              <TH>Notes</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {shown.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap font-mono text-xs">{r.row_ref.split('!')[1]}</TD>
                <TD className="max-w-[420px] text-xs">{summarize(batch.target, r.mapped)}</TD>
                <TD><StatusBadge status={r.status} /></TD>
                <TD className="max-w-[380px] text-xs text-ink-muted">{r.messages.join(' ')}</TD>
                <TD align="right">
                  {staged && ['review', 'invalid', 'valid', 'skipped', 'duplicate'].includes(r.status) && (
                    <Button variant="ghost" size="sm" onClick={() => setEdit(r)}>
                      <Pencil /> Review
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </div>
      <RowEditor row={edit} target={batch.target} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void refetch(); }} />
      <ConfirmDialog
        open={confirm === 'commit'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Import ${counts.valid ?? 0} valid rows?`}
        description="Rows marked review, invalid, duplicate or skipped stay in the review area and are not imported. The batch is recorded with your name."
        confirmLabel="Import"
        loading={busy}
        onConfirm={() => void act('commit')}
      />
      <ConfirmDialog open={confirm === 'cancel'} onOpenChange={(o) => !o && setConfirm(null)} title="Cancel this batch?" description="No records will be imported. The staged rows remain for reference." confirmLabel="Cancel batch" tone="danger" loading={busy} onConfirm={() => void act('cancel')} />
    </Card>
  );
}

function RowEditor({ row, target, onClose, onSaved }: { row: ImportRow | null; target: string; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const fields = EDIT_FIELDS[target] ?? [];
  useEffect(() => {
    if (row) setM(row.mapped);
  }, [row]);
  async function save(status: 'valid' | 'review' | 'skipped') {
    setBusy(true);
    try {
      await rpc('update_import_row', { p_row_id: row!.id, p_mapped: m, p_status: status });
      toast.success(status === 'valid' ? 'Row approved.' : status === 'skipped' ? 'Row skipped.' : 'Row kept for review.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(o) => !o && onClose()}
      title={`Review ${row?.row_ref ?? ''}`}
      description="Correct the values if needed, then approve the row. Your review is recorded."
      footer={
        <>
          <Button variant="ghost" onClick={() => void save('skipped')} disabled={busy}>Skip row</Button>
          <Button variant="secondary" onClick={() => void save('review')} disabled={busy}>Keep in review</Button>
          <Button onClick={() => void save('valid')} loading={busy}>Approve</Button>
        </>
      }
    >
      {row && (
        <div className="space-y-4">
          {row.messages.length > 0 && (
            <Callout tone="warning" title="Notes">
              <ul className="list-disc pl-4">
                {row.messages.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </Callout>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.key} label={f.label}>
                {f.type === 'type' ? (
                  <Select value={String(m[f.key] ?? '')} onChange={(e) => setM({ ...m, [f.key]: e.target.value || null })}>
                    <option value="">—</option>
                    <option value="sale">Sale</option>
                    <option value="expense">Expense</option>
                    <option value="deficit">Deficit</option>
                  </Select>
                ) : (
                  <Input
                    type={f.type}
                    value={m[f.key] === null || m[f.key] === undefined ? '' : String(m[f.key])}
                    onChange={(e) => setM({ ...m, [f.key]: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null })}
                  />
                )}
              </Field>
            ))}
          </div>
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer">Original cells</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-surface-page p-2">{JSON.stringify(row.raw, null, 1)}</pre>
          </details>
        </div>
      )}
    </Dialog>
  );
}

function BatchHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['imports', 'batches'],
    queryFn: async () => unwrap(await supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(50)) as ImportBatch[],
  });
  return (
    <Card>
      <CardHeader title="Import batches" description="Every import is kept for reconciliation." />
      {isLoading ? (
        <TableSkeleton />
      ) : data.length === 0 ? (
        <EmptyState icon={<FileSpreadsheet />} title="No imports yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Staged</TH>
              <TH>File / sheet</TH>
              <TH>Target</TH>
              <TH align="right">Rows</TH>
              <TH>Status</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {data.map((b) => (
              <TR key={b.id} onClick={() => onOpen(b.id)}>
                <TD className="whitespace-nowrap text-xs text-ink-muted">{formatDateTime(b.created_at)}</TD>
                <TD>
                  <div className="font-medium">{b.file_name}</div>
                  <div className="text-xs text-ink-muted">{b.sheet_name}</div>
                </TD>
                <TD className="text-ink-muted">{TARGET_LABEL[b.target] ?? b.target}</TD>
                <TD align="right">{b.total_rows}</TD>
                <TD><StatusBadge status={b.status} /></TD>
                <TD align="right">{b.status === 'staged' && <AlertTriangle className="inline size-4 text-warn-500" />}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
