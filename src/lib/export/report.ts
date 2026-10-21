// One report definition → Print view, PDF, Excel and CSV, so every output
// carries exactly the same filtered rows and database-calculated totals.
import type { SchoolSettings, Signatory } from '../types';
import { downloadBlob, formatDate, peso, qty, toNumber } from '../utils';

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
  orientation?: 'portrait' | 'landscape';
  filename: string;
  /** Excel worksheet name (defaults to the title) */
  sheetName?: string;
  sections?: { title: string; columns: ReportColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null }[];
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

export function headerLines(s: SchoolSettings | undefined): string[] {
  return [
    s?.header_line1 ?? 'Republic of the Philippines',
    s?.header_line2 ?? 'Department of Education',
    s?.region ?? 'Region VII, Central Visayas',
    s?.division ?? 'Schools Division of Cebu City, South District 2',
    s?.school_name ?? 'QUIOT NATIONAL HIGH SCHOOL',
    `School ID: ${s?.school_id_no ?? '312515'}`,
  ];
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
  if (r.columns.length) block(r.columns, r.rows, r.totals);
  r.sections?.forEach((s) => {
    lines.push('');
    lines.push(esc(s.title));
    block(s.columns, s.rows, s.totals);
  });
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${r.filename}.csv`);
}

async function fetchImageBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- Excel
export async function exportExcel(r: OfficialReport, settings: SchoolSettings | undefined) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QNHS Canteen System';
  wb.created = new Date();
  const ws = wb.addWorksheet((r.sheetName ?? r.title).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
    pageSetup: { paperSize: 9, orientation: r.orientation ?? 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  const allCols = Math.max(r.columns.length, ...(r.sections?.map((s) => s.columns.length) ?? [0]), 4);
  ws.columns = Array.from({ length: allCols }, (_, i) => ({ width: r.columns[i]?.width ?? (i === 0 ? 8 : 16) }));

  const [deped, qnhs] = await Promise.all([fetchImageBase64('/logos/deped.png'), fetchImageBase64(settings?.logo_url || '/logos/qnhs.png')]);
  if (deped) ws.addImage(wb.addImage({ base64: deped, extension: 'png' }), { tl: { col: 0.1, row: 0.1 }, ext: { width: 64, height: 64 } });
  if (qnhs) ws.addImage(wb.addImage({ base64: qnhs, extension: 'png' }), { tl: { col: allCols - 1 + 0.2, row: 0.1 }, ext: { width: 64, height: 64 } });

  let row = 1;
  const merged = (text: string, font: Partial<import('exceljs').Font>, height?: number) => {
    ws.mergeCells(row, 1, row, allCols);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: 'Arial', size: 10, ...font };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    if (height) ws.getRow(row).height = height;
    row++;
  };
  headerLines(settings).forEach((l, i) => merged(l, { size: i === 4 ? 12 : 10, bold: i >= 4, italic: i === 0 }));
  row++;
  merged(r.title.toUpperCase(), { size: 13, bold: true }, 20);
  merged(r.period.toUpperCase(), { bold: true });
  if (r.schoolYear) merged(`SY: ${r.schoolYear}`, { bold: false });
  row++;

  const thin = { style: 'thin' as const, color: { argb: 'FF9AA59D' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
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
        cell.alignment = { horizontal: c.format === 'peso' || c.format === 'qty' || c.format === 'percent' ? 'right' : 'left', vertical: 'middle', wrapText: c.format === 'text' || !c.format };
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
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${r.filename}.xlsx`);
}

// ------------------------------------------------------------------- PDF
export async function exportPdf(r: OfficialReport, settings: SchoolSettings | undefined) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: r.orientation ?? 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const margin = 36;
  const [deped, qnhs] = await Promise.all([fetchImageBase64('/logos/deped.png'), fetchImageBase64(settings?.logo_url || '/logos/qnhs.png')]);
  if (deped) doc.addImage(deped, 'PNG', margin, 28, 58, 58);
  if (qnhs) doc.addImage(qnhs, 'PNG', W - margin - 58, 28, 58, 58);

  let y = 38;
  headerLines(settings).forEach((l, i) => {
    doc.setFont('helvetica', i >= 4 ? 'bold' : i === 0 ? 'italic' : 'normal');
    doc.setFontSize(i === 4 ? 12 : 9.5);
    doc.text(l, W / 2, y, { align: 'center' });
    y += i === 3 ? 15 : 12.5;
  });
  doc.setDrawColor(8, 122, 53);
  doc.setLineWidth(1.2);
  doc.line(margin, y, W - margin, y);
  y += 22;
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
      margin: { left: margin, right: margin },
      head: [cols.map((c) => (c.format === 'peso' ? `${c.header} (PHP)` : c.header).toUpperCase())],
      body: rows.map((row) => cols.map((c) => pdfCell(row[c.key], c.format))),
      foot: totals ? [cols.map((c) => pdfCell(totals[c.key], c.format))] : undefined,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3.5, lineColor: [190, 200, 193], lineWidth: 0.5, textColor: [32, 41, 35] },
      headStyles: { fillColor: [8, 122, 53], textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
      footStyles: { fillColor: [234, 244, 236], textColor: [32, 41, 35], fontStyle: 'bold' },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: c.format === 'peso' || c.format === 'qty' || c.format === 'percent' ? 'right' : 'left' }])),
      didDrawPage: () => {
        const H = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(107, 117, 109);
        doc.text(`${settings?.school_name ?? 'QUIOT NATIONAL HIGH SCHOOL'} · ${r.title}`, margin, H - 18);
        doc.text(`Page ${doc.getNumberOfPages()}`, W - margin, H - 18, { align: 'right' });
        doc.setTextColor(32, 41, 35);
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  };

  if (r.columns.length) table(r.columns, r.rows, r.totals);
  r.sections?.forEach((s) => {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      y = 48;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(s.title, margin, y);
    y += 8;
    table(s.columns, s.rows, s.totals);
  });

  if (r.summary?.length) {
    const boxW = 260;
    r.summary.forEach((s) => {
      if (y > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage();
        y = 48;
      }
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
    doc.text(lines, margin, y);
    y += lines.length * 10;
  });

  const sigs = signatories(settings);
  if (sigs.length) {
    if (y > doc.internal.pageSize.getHeight() - 110) {
      doc.addPage();
      y = 60;
    }
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

  doc.save(`${r.filename}.pdf`);
}
