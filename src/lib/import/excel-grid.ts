import type { Workbook, Worksheet, CellValue as ExcelCellValue } from 'exceljs';
import type { CellValue, Grid } from './workbook';

function plain(v: ExcelCellValue): CellValue {
  if (v === null || v === undefined) return null;
  // exceljs turns empty results of date-formatted formulas into Invalid Date
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object') {
    if ('result' in v) return plain((v as { result?: ExcelCellValue }).result ?? null);
    if ('formula' in v || 'sharedFormula' in v) return null; // formula without cached result
    if ('richText' in v) return (v.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return null;
    return null;
  }
  return v as CellValue;
}

export function worksheetToGrid(ws: Worksheet): Grid {
  return {
    name: ws.name,
    rowCount: ws.rowCount,
    colCount: ws.columnCount,
    value(row, col) {
      if (row < 1 || col < 1) return null;
      const cell = ws.getRow(row).getCell(col);
      // merged cells repeat the master's value; only the master holds data
      if (cell.isMerged && cell.master.address !== cell.address) return null;
      return plain(cell.value);
    },
    formula(row, col) {
      if (row < 1 || col < 1) return null;
      const cell = ws.getRow(row).getCell(col);
      const v = cell.value as { formula?: string; sharedFormula?: string } | null;
      if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
        return (cell.formula as string | undefined) ?? v.formula ?? null;
      }
      return null;
    },
  };
}

export async function loadWorkbook(data: ArrayBuffer): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb;
}
