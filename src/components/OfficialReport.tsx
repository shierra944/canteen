import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/providers/app';
import { useAuth } from '@/providers/auth';
import { exportCsv, exportExcel, exportPdf, formatCell, headerLines, signatories, type OfficialReport } from '@/lib/export/report';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/menu';

/** Export / print menu. Disabled unless the user holds reports.export. */
export function ExportMenu({ report, disabled }: { report: () => OfficialReport; disabled?: boolean }) {
  const { settings } = useApp();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!can('reports.export')) return null;
  const run = async (kind: 'xlsx' | 'pdf' | 'csv' | 'print') => {
    if (kind === 'print') {
      window.print();
      return;
    }
    setBusy(true);
    try {
      const r = report();
      if (kind === 'csv') exportCsv(r);
      else if (kind === 'xlsx') await exportExcel(r, settings);
      else await exportPdf(r, settings);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" loading={busy} disabled={disabled}>
          <FileDown /> Export
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<Printer />} onSelect={() => void run('print')}>
          Print report
        </MenuItem>
        <MenuItem icon={<FileText />} onSelect={() => void run('pdf')}>
          Export to PDF
        </MenuItem>
        <MenuItem icon={<FileSpreadsheet />} onSelect={() => void run('xlsx')}>
          Export to Excel
        </MenuItem>
        <MenuItem icon={<FileDown />} onSelect={() => void run('csv')}>
          Download CSV
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Official printed layout (hidden on screen, shown when printing). */
export function PrintableReport({ report, className }: { report: OfficialReport | null; className?: string }) {
  const { settings } = useApp();
  if (!report) return null;
  const lines = headerLines(settings);
  const sigs = signatories(settings);
  const table = (cols: OfficialReport['columns'], rows: OfficialReport['rows'], totals?: OfficialReport['totals']) => (
    <table className="mt-3 w-full border-collapse text-[10px]">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} className="border border-[#9aa59d] bg-[#087A35] px-1.5 py-1 text-center font-bold uppercase text-white" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key} className={cn('border border-[#9aa59d] px-1.5 py-0.5', (c.format === 'peso' || c.format === 'qty') && 'text-right tabular')}>
                {formatCell(r[c.key], c.format)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr>
            {cols.map((c) => (
              <td key={c.key} className={cn('border border-[#9aa59d] bg-[#EAF4EC] px-1.5 py-1 font-bold', (c.format === 'peso' || c.format === 'qty') && 'text-right tabular')}>
                {formatCell(totals[c.key], c.format)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
  return (
    <div className={cn('print-only text-ink', report.orientation === 'landscape' && 'print-landscape', className)}>
      <div className="flex items-center justify-between">
        <img src="/logos/deped.png" alt="" className="size-16" />
        <div className="text-center leading-tight">
          {lines.map((l, i) => (
            <div key={i} className={cn(i === 0 && 'italic', i >= 4 && 'font-bold', i === 4 ? 'text-[14px]' : 'text-[11px]')}>
              {l}
            </div>
          ))}
        </div>
        <img src={settings?.logo_url || '/logos/qnhs.png'} alt="" className="size-16" />
      </div>
      <div className="mt-2 border-t-2 border-[#087A35]" />
      <div className="mt-4 text-center">
        <div className="text-[14px] font-bold uppercase">{report.title}</div>
        <div className="text-[11px] font-bold uppercase">{report.period}</div>
        {report.schoolYear && <div className="text-[11px]">SY: {report.schoolYear}</div>}
      </div>
      {report.columns.length > 0 && table(report.columns, report.rows, report.totals)}
      {report.sections?.map((s) => (
        <div key={s.title} className="mt-4" style={{ breakInside: 'avoid' }}>
          <div className="text-[11px] font-bold">{s.title}</div>
          {table(s.columns, s.rows, s.totals)}
        </div>
      ))}
      {report.summary && (
        <div className="ml-auto mt-4 w-72 text-[11px]">
          {report.summary.map((s) => (
            <div key={s.label} className={cn('flex justify-between border-b border-dotted border-[#9aa59d] py-0.5', s.emphasis && 'font-bold')}>
              <span>{s.label}</span>
              <span className="tabular">{s.value}</span>
            </div>
          ))}
        </div>
      )}
      {report.notes?.map((n) => (
        <p key={n} className="mt-2 text-[9px] italic text-ink-muted">
          {n}
        </p>
      ))}
      {sigs.length > 0 && (
        <div className="mt-10 grid gap-8" style={{ gridTemplateColumns: `repeat(${sigs.length}, minmax(0, 1fr))`, breakInside: 'avoid' }}>
          {sigs.map((s) => (
            <div key={s.label + s.name} className="text-[11px]">
              <div>{s.label}</div>
              <div className="mt-9 inline-block min-w-[180px] border-b border-ink font-bold uppercase">{s.name}</div>
              <div>{s.position}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
