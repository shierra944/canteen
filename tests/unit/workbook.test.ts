// Parses the school's real CANTEEN REPORT.xlsx when it is present locally
// (it is git-ignored). Verifies the parser recovers the workbook's own totals.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { worksheetToGrid } from '../../src/lib/import/excel-grid';
import {
  buildBlockDateLookup,
  parseDailySales,
  parseDate,
  parseExpensesAndOtherSales,
  parseSummary,
} from '../../src/lib/import/workbook';

const file = join(__dirname, '..', '..', 'CANTEEN REPORT.xlsx');
const hasFile = existsSync(file);

describe('parseDate', () => {
  it('reads workbook date formats', () => {
    expect(parseDate('MARCH 2, 2026').iso).toBe('2026-03-02');
    expect(parseDate('03/13/2026').iso).toBe('2026-03-13');
    expect(parseDate('02/30/2026').iso).toBeNull();
    expect(parseDate(new Date(Date.UTC(2026, 1, 3))).iso).toBe('2026-02-03');
  });
});

describe.skipIf(!hasFile)('CANTEEN REPORT.xlsx', async () => {
  const wb = new ExcelJS.Workbook();
  if (hasFile) await wb.xlsx.readFile(file);
  const grid = (name: string) => worksheetToGrid(wb.getWorksheet(name)!);

  it('finds every DAILY SALES block and reproduces its SHARE total', () => {
    const res = parseDailySales(grid('DAILY SALES'));
    const march2 = res.blocks.find((b) => b.date === '2026-03-02')!;
    expect(march2).toBeTruthy();
    // Workbook SUMMARY: Daily Canteen Shares for March 2 = 567 ('DAILY SALES'!J15)
    expect(march2.checks.find((c) => c.label.startsWith('Total share'))!.workbook).toBe(567);
    expect(new Set(res.blocks.map((b) => b.date)).size).toBe(res.blocks.length);
    // Turon Saging (sold 37 of 30) must be flagged, not silently imported
    const turon = res.rows.find((r) => r.group_key === '2026-03-02' && r.mapped.item_name === 'Turon Saging')!;
    expect(turon.status).toBe('review');
  });

  it('reads EXPENSES & OTHER SALES blocks with workbook totals', () => {
    const res = parseExpensesAndOtherSales(grid('EXPENSES & OTHER SALES'));
    const m2 = res.blocks.find((b) => b.date === '2026-03-02')!;
    expect(m2.checks.find((c) => c.label === 'Sale total')).toMatchObject({ workbook: 1096, recalculated: 1096, ok: true });
    expect(m2.checks.find((c) => c.label === 'Expense total')).toMatchObject({ workbook: 544, recalculated: 544, ok: true });
    const m4 = res.blocks.find((b) => b.date === '2026-03-04')!;
    expect(m4.checks.find((c) => c.label === 'Deficit total')).toMatchObject({ workbook: 173, recalculated: 173 });
    expect(res.rows.every((r) => r.status !== 'valid' || r.mapped.transaction_type)).toBe(true);
  });

  it('resolves swapped SUMMARY dates through the linked day blocks', () => {
    const daily = parseDailySales(grid('DAILY SALES'));
    const exp = parseExpensesAndOtherSales(grid('EXPENSES & OTHER SALES'));
    const { references, carryovers } = parseSummary(grid('SUMMARY'), buildBlockDateLookup(daily, exp));
    const first = references.rows[0];
    expect(first.mapped.report_date).toBe('2026-03-02'); // typed as a date that Excel stored as Feb 3
    expect(first.mapped).toMatchObject({ actual_money: 7348, daily_canteen_shares: 567, other_shares: 1096, net_sales: 1119 });
    expect(new Set(references.rows.map((r) => r.mapped.report_date)).size).toBe(references.rows.length);
    expect(carryovers.rows.map((r) => r.mapped.description)).toEqual(['January - cash', 'February - cash', 'c/o Mam Nechelle']);
  });
});
