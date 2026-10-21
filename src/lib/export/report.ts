// One report definition → Print view, PDF, Excel and CSV, so every output
// carries exactly the same filtered rows and database-calculated totals.
import type { SchoolSettings, Signatory } from '../types';
import { downloadBlob, formatDate, peso, qty, toNumber } from '../utils';
import { LETTERHEAD_CONTENT_FRACTION, renderLetterhead } from './letterhead';

export type ColFormat = 'text' | 'peso' | 'qty' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  header: string;
  format?: ColFormat;
  width?: number; // relative width (Excel characters)
}

export interface OfficialReport {
  title: string;
  period: string;
  schoolYear?: string | null;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown> | null;
  summary?: { label: string; value: string; emphasis?: boolean }[];
  notes?: string[];
  filename: string;
  /** Excel worksheet name (defaults to the title) */
  sheetName?: string;
  sections?: { title: string; columns: ReportColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null }[];
  /** The canteen's cash as of the day the report is generated (added by the export menu). */
  moneyOnHand?: { amount: number; asOf: string } | null;
}

/** "MONEY ON HAND AS OF OCTOBER 21, 2026" */
export function moneyOnHandLabel(m: { asOf: string }): string {
  return `Money on hand as of ${formatDate(m.asOf, 'long')}`.toUpperCase();
}

export function formatCell(v: unknown, f: ColFormat = 'text'): string {
  if (v === null || v === undefined || v === '') return f === 'peso' || f === 'qty' ? '' : '';
  switch (f) {
    case 'peso':
      return peso(v);
    case 'qty':
      return qty(v);
    case 'date':
      return formatDate(String(v));
    case 'percent':
      return `${toNumber(v).toFixed(1)}%`;
    default:
      return String(v);
  }
}

export function signatories(s: SchoolSettings | undefined): Signatory[] {
  if (s && !s.export_include_signatories) return [];
  return s?.signatories ?? [];
}

// ------------------------------------------------------------------- CSV
export function exportCsv(r: OfficialReport) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const raw = (v: unknown, f?: ColFormat) => (v === null || v === undefined ? '' : f === 'peso' || f === 'qty' ? String(toNumber(v)) : f === 'date' ? String(v) : String(v));
  const lines: string[] = [];
  const block = (cols: ReportColumn[], rows: Record<string, unknown>[], totals?: Record<string, unknown> | null) => {
    lines.push(cols.map((c) => esc(c.header)).join(','));
    rows.forEach((row) => lines.push(cols.map((c) => esc(raw(row[c.key], c.format))).join(',')));
    if (totals) lines.push(cols.map((c) => esc(raw(totals[c.key], c.format))).join(','));
  };
  if (r.moneyOnHand) lines.push(`${esc(moneyOnHandLabel(r.moneyOnHand))},${r.moneyOnHand.amount}`, '');
  if (r.columns.length) block(r.columns, r.rows, r.totals);
  r.sections?.forEach((s) => {
    lines.push('');
    lines.push(esc(s.title));
    block(s.columns, s.rows, s.totals);
  });
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${r.filename}.csv`);
}

/** Every report is A4 portrait with a one-inch margin on all sides. */
const MARGIN_IN = 1;

// ----------------------------------------------------------------- Excel
export async function exportExcel(r: OfficialReport, settings: SchoolSettings | undefined) {
  const [ExcelJS, letterhead] = await Promise.all([import('exceljs').then((m) => m.default), renderLetterhead(settings)]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QNHS Canteen System';
  wb.created = new Date();
  const ws = wb.addWorksheet((r.sheetName ?? r.title).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: MARGIN_IN, right: MARGIN_IN, top: MARGIN_IN, bottom: MARGIN_IN, header: MARGIN_IN / 2, footer: MARGIN_IN / 2 },
    },
  });
  const allCols = Math.max(r.columns.length, ...(r.sections?.map((s) => s.columns.length) ?? [0]), 4);
  ws.columns = Array.from({ length: allCols }, (_, i) => {
    const w = r.columns[i]?.width ?? (i === 0 ? 8 : 16);
    // wide enough for "Sep 30, 2026" on one line
    return { width: r.columns[i]?.format === 'date' ? Math.max(w, 15) : w };
  });

  // Letterhead image across the sheet width (Excel column width ≈ 7 px per unit)
  const sheetPx = (ws.columns as { width?: number }[]).reduce((a, c) => a + (c.width ?? 10) * 7 + 5, 0);
  // rules span the sheet; the content itself is capped so it never gets oversized
  const imgW = Math.min(sheetPx, 640 / LETTERHEAD_CONTENT_FRACTION);
  const imgX = (sheetPx - imgW) / 2;
  const colAt = (px: number) => {
    // fractional column index for a pixel offset
    let acc = 0;
    for (let i = 0; i < allCols; i++) {
      const w = ((ws.columns as { width?: number }[])[i].width ?? 10) * 7 + 5;
      if (acc + w > px) return i + (px - acc) / w;
      acc += w;
    }
    return allCols;
  };
  const ROW_PX = 20;
  const headerH = (imgW * letterhead.header.height) / letterhead.header.width;
  ws.addImage(wb.addImage({ base64: letterhead.header.dataUrl, extension: 'png' }), { tl: { col: colAt(imgX), row: 0.2 }, ext: { width: imgW, height: headerH } });
  let row = Math.ceil(headerH / ROW_PX) + 2;

  const merged = (text: string, font: Partial<import('exceljs').Font>, height?: number) => {
    ws.mergeCells(row, 1, row, allCols);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: 'Arial', size: 10, ...font };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    if (height) ws.getRow(row).height = height;
    row++;
  };
  merged(r.title.toUpperCase(), { size: 13, bold: true }, 20);
  merged(r.period.toUpperCase(), { bold: true });
  if (r.schoolYear) merged(`SY: ${r.schoolYear}`, { bold: false });
  row++;

  const thin = { style: 'thin' as const, color: { argb: 'FF9AA59D' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  if (r.moneyOnHand) {
    // highlighted band right under the title: label | amount
    const split = Math.max(1, allCols - 2);
    ws.mergeCells(row, 1, row, split);
    ws.mergeCells(row, split + 1, row, allCols);
    const label = ws.getCell(row, 1);
    const amount = ws.getCell(row, split + 1);
    label.value = moneyOnHandLabel(r.moneyOnHand);
    amount.value = r.moneyOnHand.amount;
    amount.numFmt = '"₱"#,##0.00;[Red]-"₱"#,##0.00';
    for (const c of [label, amount]) {
      c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF075B2B' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF4EC' } };
      c.border = { top: { style: 'medium', color: { argb: 'FF087A35' } }, bottom: { style: 'medium', color: { argb: 'FF087A35' } }, left: thin, right: thin };
    }
    label.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    amount.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    ws.getRow(row).height = 24;
    row += 2;
  }
  const writeTable = (cols: ReportColumn[], rows: Record<string, unknown>[], totals?: Record<string, unknown> | null) => {
    const hr = ws.getRow(row);
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.header.toUpperCase();
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087A35' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
    });
    hr.height = 28;
    row++;
    const put = (data: Record<string, unknown>, bold: boolean) => {
      const rr = ws.getRow(row);
      cols.forEach((c, i) => {
        const cell = rr.getCell(i + 1);
        const v = data[c.key];
        if (v === null || v === undefined || v === '') cell.value = null;
        else if (c.format === 'peso' || c.format === 'qty') cell.value = toNumber(v);
        else if (c.format === 'date') cell.value = formatDate(String(v));
        else if (c.format === 'percent') cell.value = toNumber(v) / 100;
        else cell.value = String(v);
        cell.numFmt = c.format === 'peso' ? '"₱"#,##0.00;[Red]-"₱"#,##0.00' : c.format === 'qty' ? '#,##0.###' : c.format === 'percent' ? '0.0%' : '@';
        cell.font = { name: 'Arial', size: 9, bold };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: c.format !== 'date' };
        cell.border = border;
        if (bold) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF4EC' } };
      });
      row++;
    };
    rows.forEach((d) => put(d, false));
    if (totals) put(totals, true);
  };

  if (r.columns.length) writeTable(r.columns, r.rows, r.totals);
  r.sections?.forEach((s) => {
    row++;
    ws.mergeCells(row, 1, row, allCols);
    ws.getCell(row, 1).value = s.title;
    ws.getCell(row, 1).font = { name: 'Arial', size: 10, bold: true };
    row++;
    writeTable(s.columns, s.rows, s.totals);
  });

  if (r.summary?.length) {
    row++;
    r.summary.forEach((s) => {
      ws.getCell(row, Math.max(1, allCols - 1)).value = s.label;
      ws.getCell(row, Math.max(1, allCols - 1)).font = { name: 'Arial', size: 9, bold: s.emphasis };
      ws.getCell(row, allCols).value = s.value;
      ws.getCell(row, allCols).font = { name: 'Arial', size: 9, bold: true };
      ws.getCell(row, allCols).alignment = { horizontal: 'right' };
      row++;
    });
  }
  r.notes?.forEach((n) => {
    row++;
    ws.mergeCells(row, 1, row, allCols);
    ws.getCell(row, 1).value = n;
    ws.getCell(row, 1).font = { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B756D' } };
    ws.getCell(row, 1).alignment = { wrapText: true };
  });

  const sigs = signatories(settings);
  if (sigs.length) {
    row += 2;
    const span = Math.max(1, Math.floor(allCols / sigs.length));
    sigs.forEach((s, i) => {
      const col = 1 + i * span;
      ws.getCell(row, col).value = s.label;
      ws.getCell(row, col).font = { name: 'Arial', size: 9 };
      ws.getCell(row + 3, col).value = s.name;
      ws.getCell(row + 3, col).font = { name: 'Arial', size: 10, bold: true, underline: true };
      ws.getCell(row + 4, col).value = s.position;
      ws.getCell(row + 4, col).font = { name: 'Arial', size: 9 };
    });
    row += 5;
  }

  // Letterhead footer below the content
  row += 2;
  const footerH = (imgW * letterhead.footer.height) / letterhead.footer.width;
  ws.addImage(wb.addImage({ base64: letterhead.footer.dataUrl, extension: 'png' }), { tl: { col: colAt(imgX), row: row - 1 }, ext: { width: imgW, height: footerH } });

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${r.filename}.xlsx`);
}

// ------------------------------------------------------------------- PDF
export async function exportPdf(r: OfficialReport, settings: SchoolSettings | undefined) {
  const [{ jsPDF }, autoTableMod, letterhead] = await Promise.all([import('jspdf'), import('jspdf-autotable'), renderLetterhead(settings)]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = MARGIN_IN * 72;

  // Letterhead geometry (drawn on every page at the end)
  // like a Word header/footer: half an inch from the edge, rules spanning the margins
  const lhW = W - margin * 2;
  const lhX = margin;
  const headerH = (lhW * letterhead.header.height) / letterhead.header.width;
  const footerH = (lhW * letterhead.footer.height) / letterhead.footer.width;
  const HEADER_TOP = margin / 2;
  const FOOTER_BOTTOM = margin / 2;
  const CONTENT_TOP = Math.max(margin, HEADER_TOP + headerH + 12);
  const CONTENT_BOTTOM = Math.min(H - margin, H - FOOTER_BOTTOM - footerH - 12);

  let y = CONTENT_TOP + 8;
  const newPage = () => {
    doc.addPage();
    y = CONTENT_TOP + 8;
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text(r.title.toUpperCase(), W / 2, y, { align: 'center' });
  y += 15;
  doc.setFontSize(10);
  doc.text(r.period.toUpperCase(), W / 2, y, { align: 'center' });
  if (r.schoolYear) {
    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.text(`SY: ${r.schoolYear}`, W / 2, y, { align: 'center' });
  }
  y += 14;
  if (r.moneyOnHand) {
    // highlighted band right under the title: label left, amount right
    const bandH = 24;
    doc.setFillColor(234, 244, 236);
    doc.setDrawColor(8, 122, 53);
    doc.setLineWidth(1);
    doc.rect(margin, y, W - margin * 2, bandH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(7, 91, 43);
    doc.text(moneyOnHandLabel(r.moneyOnHand), margin + 10, y + 15.5);
    const n = r.moneyOnHand.amount;
    // jsPDF's built-in fonts lack the ₱ glyph
    doc.text(`PHP ${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, W - margin - 10, y + 15.5, { align: 'right' });
    doc.setTextColor(32, 41, 35);
    y += bandH + 14;
  }

  // jsPDF's built-in fonts lack the ₱ glyph; use "PHP" in PDF cells.
  const pdfCell = (v: unknown, f?: ColFormat) => {
    if (v === null || v === undefined || v === '') return '';
    if (f === 'peso') {
      const n = toNumber(v);
      return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return formatCell(v, f);
  };
  const table = (cols: ReportColumn[], rows: Record<string, unknown>[], totals?: Record<string, unknown> | null) => {
    autoTable(doc, {
      startY: y,
      // keep tables clear of the letterhead on every page
      margin: { left: margin, right: margin, top: CONTENT_TOP, bottom: H - CONTENT_BOTTOM },
      head: [cols.map((c) => (c.format === 'peso' ? `${c.header} (PHP)` : c.header).toUpperCase())],
      body: rows.map((row) => cols.map((c) => pdfCell(row[c.key], c.format))),
      foot: totals ? [cols.map((c) => pdfCell(totals[c.key], c.format))] : undefined,
      showFoot: 'lastPage',
      theme: 'grid',
      // portrait page: long text wraps inside its column; many columns get a smaller font
      styles: { font: 'helvetica', fontSize: cols.length > 8 ? 7 : 8, cellPadding: cols.length > 8 ? 2.5 : 3.5, overflow: 'linebreak', lineColor: [190, 200, 193], lineWidth: 0.5, textColor: [32, 41, 35], halign: 'center', valign: 'middle' },
      headStyles: { fillColor: [8, 122, 53], textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
      footStyles: { fillColor: [234, 244, 236], textColor: [32, 41, 35], fontStyle: 'bold', halign: 'center', valign: 'middle' },
      // dates never wrap: the column grows to fit the date on one line
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, c.format === 'date' ? { halign: 'center', cellWidth: 'wrap' } : { halign: 'center' }])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  };

  if (r.columns.length) table(r.columns, r.rows, r.totals);
  r.sections?.forEach((s) => {
    if (y > CONTENT_BOTTOM - 60) newPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(s.title, margin, y);
    y += 8;
    table(s.columns, s.rows, s.totals);
  });

  if (r.summary?.length) {
    const boxW = 260;
    r.summary.forEach((s) => {
      if (y > CONTENT_BOTTOM - 10) newPage();
      doc.setFont('helvetica', s.emphasis ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.text(s.label, W - margin - boxW, y);
      doc.setFont('helvetica', 'bold');
      doc.text(s.value.replace('₱', 'PHP '), W - margin, y, { align: 'right' });
      y += 13;
    });
    y += 6;
  }
  r.notes?.forEach((n) => {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    const lines = doc.splitTextToSize(n, W - margin * 2);
    if (y + lines.length * 10 > CONTENT_BOTTOM) newPage();
    doc.text(lines, margin, y);
    y += lines.length * 10;
  });

  const sigs = signatories(settings);
  if (sigs.length) {
    if (y + 80 > CONTENT_BOTTOM) newPage();
    y += 26;
    const colW = (W - margin * 2) / sigs.length;
    sigs.forEach((s, i) => {
      const x = margin + i * colW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(s.label, x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(s.name, x + 10, y + 38);
      const tw = doc.getTextWidth(s.name);
      doc.setLineWidth(0.6);
      doc.setDrawColor(32, 41, 35);
      doc.line(x + 10, y + 41, x + 10 + Math.max(tw, 120), y + 41);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(s.position, x + 10, y + 53);
    });
  }

  // Letterhead header + footer and page numbers on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.addImage(letterhead.header.dataUrl, 'PNG', lhX, HEADER_TOP, lhW, headerH);
    doc.addImage(letterhead.footer.dataUrl, 'PNG', lhX, H - FOOTER_BOTTOM - footerH, lhW, footerH);
    if (pages > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(107, 117, 109);
      doc.text(`Page ${p} of ${pages}`, W - margin, H - FOOTER_BOTTOM - footerH - 6, { align: 'right' });
      doc.setTextColor(32, 41, 35);
    }
  }

  doc.save(`${r.filename}.pdf`);
}
