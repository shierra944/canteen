import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/providers/app';
import { useAuth } from '@/providers/auth';
import { exportCsv, exportExcel, exportPdf, formatCell, signatories, type OfficialReport } from '@/lib/export/report';
import { CONTACT_ICONS, LETTERHEAD_FONT, ensureLetterheadFont, letterheadContent, svgDataUrl } from '@/lib/export/letterhead';
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
      // the letterhead font must be loaded before the print dialog renders
      await ensureLetterheadFont();
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
    <div className={cn('print-only text-ink', report.orientation === 'landscape' && 'print-landscape', className)}>
      {/* footer pinned to the bottom of every printed page */}
      <div className="fixed inset-x-0 bottom-0 bg-white px-[6mm] pb-[2mm]">
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
              <div className="h-[34mm]" />
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

/** Official DepEd letterhead header (seal, Old English lines, school line, rule). */
export function LetterheadHeader({ settings }: { settings: SchoolSettings | undefined }) {
  const t = letterheadContent(settings);
  return (
    <div className="text-center leading-tight text-[#595959]" style={exact}>
      <img src="/logos/deped.png" alt="DepEd seal" className="mx-auto h-[13mm] w-[13mm] object-contain" />
      <div className="mt-1 text-[14px] font-medium" style={{ fontFamily: `"${LETTERHEAD_FONT}", Georgia, serif` }}>
        {t.republic}
      </div>
      <div className="text-[18px] font-medium" style={{ fontFamily: `"${LETTERHEAD_FONT}", Georgia, serif` }}>
        {t.department}
      </div>
      <div className="mt-0.5 font-[Arial,Helvetica,sans-serif] text-[9.5px]">{t.region}</div>
      <div className="font-[Arial,Helvetica,sans-serif] text-[10px] font-bold">{t.division}</div>
      <div className="font-[Arial,Helvetica,sans-serif] text-[10px] font-bold">{t.schoolLine}</div>
      <div className="mt-1 h-[2px] bg-[#808080]" />
    </div>
  );
}

/** Official letterhead footer (logos + contact details). */
export function LetterheadFooter({ settings }: { settings: SchoolSettings | undefined }) {
  const t = letterheadContent(settings);
  const rows: [string, string, boolean][] = [
    [CONTACT_ICONS.location, t.address, false],
    [CONTACT_ICONS.phone, t.phone, false],
    [CONTACT_ICONS.email, t.email, true],
    [CONTACT_ICONS.facebook, t.facebook, false],
  ];
  return (
    <div className="font-[Arial,Helvetica,sans-serif]" style={exact}>
      <div className="h-px bg-[#808080]" />
      <div className="flex items-center gap-5 pt-2">
        <div className="flex w-[19mm] flex-col items-center">
          <img src="/logos/bagong-pilipinas.jpg" alt="Bagong Pilipinas" className="h-[15mm] object-contain" />
          <span className="mt-0.5 text-[6.5px] font-bold tracking-wide text-[#5B6E8F]">BAGONG PILIPINAS</span>
        </div>
        <div className="flex w-[29mm] flex-col items-center gap-1">
          <img src="/logos/deped-wordmark.webp" alt="DepEd" className="h-[11mm] object-contain" />
          <img src="/logos/matatag.png" alt="MATATAG" className="h-[8mm] object-contain" />
        </div>
        <img src={t.qnhsLogo} alt="Quiot National High School" className="h-[21mm] w-[21mm] object-contain" />
        <ul className="ml-6 space-y-[3px] text-[11px] text-[#555]">
          {rows.map(([icon, text, link]) => (
            <li key={text} className="flex items-center gap-2">
              <img src={svgDataUrl(icon)} alt="" className="h-[13px] w-[13px]" />
              <span className={link ? 'text-[#2F6FB6] underline' : ''}>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
