import { useState, useEffect } from 'react';
import { FileDown, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/providers/app';
import { useAuth } from '@/providers/auth';
import { exportCsv, exportExcel, exportPdf, formatCell, signatories, type OfficialReport } from '@/lib/export/report';
import { renderLetterhead, type LetterheadImages } from '@/lib/export/letterhead';
import type { SchoolSettings } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/menu';

/** Export / print menu. Disabled unless the user holds reports.export. */
export function ExportMenu({
  report,
  disabled,
  allow,
  label = 'Export',
}: {
  report: () => OfficialReport;
  disabled?: boolean;
  /** override the default reports.export permission check */
  allow?: boolean;
  label?: string;
}) {
  const { settings } = useApp();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!(allow ?? can('reports.export'))) return null;
  const run = async (kind: 'xlsx' | 'pdf' | 'csv' | 'print') => {
    if (kind === 'print') {
      // make sure the letterhead images are ready before the print dialog renders
      await renderLetterhead(settings);
      await new Promise((r) => setTimeout(r, 60));
      // "Save as PDF" from the print dialog uses the page title as file name
      const previous = document.title;
      document.title = report().filename;
      window.print();
      document.title = previous;
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
          <FileDown /> {label}
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
  const sigs = signatories(settings);
  const table = (cols: OfficialReport['columns'], rows: OfficialReport['rows'], totals?: OfficialReport['totals']) => (
    <table className="mt-3 w-full border-collapse text-[10px] [overflow-wrap:anywhere]">
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
              <td key={c.key} className={cn('border border-[#9aa59d] px-1.5 py-0.5 text-center', (c.format === 'peso' || c.format === 'qty') && 'tabular', c.format === 'date' && 'whitespace-nowrap')}>
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
              <td key={c.key} className={cn('border border-[#9aa59d] bg-[#EAF4EC] px-1.5 py-1 text-center font-bold', (c.format === 'peso' || c.format === 'qty') && 'tabular', c.format === 'date' && 'whitespace-nowrap')}>
                {formatCell(totals[c.key], c.format)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
  return (
    <div className={cn('print-only text-ink', className)}>
      {/* footer pinned to the bottom of every printed page */}
      <div className="fixed inset-x-0 bottom-0 bg-white">
        <LetterheadFooter settings={settings} />
      </div>
      {/* thead / tfoot repeat on every printed page: header + space for the footer */}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <td className="p-0 pb-3">
              <LetterheadHeader settings={settings} />
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td className="p-0">
              <div className="h-[30mm]" />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="p-0">
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
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const exact = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as const;
// letterhead width on paper (same as the PDF): the template's proportions
const LETTERHEAD_PRINT_WIDTH = '158mm';

/** The rendered letterhead (identical to the PDF / Excel one). */
function useLetterheadImages(settings: SchoolSettings | undefined) {
  const [images, setImages] = useState<LetterheadImages | null>(null);
  useEffect(() => {
    let alive = true;
    renderLetterhead(settings).then((r) => alive && setImages(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [settings]);
  return images;
}

/** Official DepEd letterhead header, exactly as in the school's template. */
export function LetterheadHeader({ settings }: { settings: SchoolSettings | undefined }) {
  const images = useLetterheadImages(settings);
  if (!images) return <div style={{ height: '51mm' }} />;
  return <img src={images.header.dataUrl} alt="DepEd letterhead" className="mx-auto block" style={{ ...exact, width: LETTERHEAD_PRINT_WIDTH }} />;
}

/** Official letterhead footer (logos + contact details). */
export function LetterheadFooter({ settings }: { settings: SchoolSettings | undefined }) {
  const images = useLetterheadImages(settings);
  if (!images) return null;
  return <img src={images.footer.dataUrl} alt="School contact details" className="mx-auto block" style={{ ...exact, width: LETTERHEAD_PRINT_WIDTH }} />;
}
