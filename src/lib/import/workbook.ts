// Parsers for the school's CANTEEN REPORT.xlsx layout.
//
// The workbook repeats one block per day side-by-side (and in two vertical
// bands). Each block has a date title ("MARCH 2, 2026") above a header row.
// We locate blocks by their header cells, read only the INPUT cells (never
// Excel formulas as values), recalculate totals ourselves, and flag anything
// that does not reconcile for administrator review.

export type CellValue = string | number | boolean | Date | null;

export interface Grid {
  name: string;
  rowCount: number;
  colCount: number;
  /** Plain value (formula cells return their cached result). */
  value(row: number, col: number): CellValue;
  /** Formula text if the cell holds a formula. */
  formula(row: number, col: number): string | null;
}

export type RowStatus = 'valid' | 'invalid' | 'review' | 'skipped';

export interface StagedRow {
  row_ref: string;
  group_key?: string;
  status: RowStatus;
  messages: string[];
  raw: Record<string, unknown>;
  mapped: Record<string, unknown>;
}

export interface BlockSummary {
  key: string;
  date: string | null;
  title: string;
  anchor: string;
  rowCount: number;
  checks: { label: string; workbook: number | null; recalculated: number; ok: boolean }[];
}

export interface ParseResult {
  target: 'daily_sales' | 'financial_transactions' | 'summary_reference' | 'cash_carryovers';
  rows: StagedRow[];
  blocks: BlockSummary[];
  warnings: string[];
}

// ---------------------------------------------------------------- helpers
export function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(letters: string): number {
  return letters.toUpperCase().split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
}

export const addr = (row: number, col: number) => `${colLetter(col)}${row}`;

function text(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoFromDate(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

function norm(v: CellValue): string {
  return text(v).toUpperCase();
}

function isoFromDate(d: Date): string {
  // exceljs returns dates as UTC midnight
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function validIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return isoFromDate(dt);
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/**
 * Parse workbook dates. Text is read as the workbook writes it:
 * "MARCH 2, 2026" or US-style "03/13/2026" (MM/DD/YYYY).
 */
export function parseDate(v: CellValue): { iso: string | null; source: 'date' | 'text' | null } {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? { iso: null, source: null } : { iso: isoFromDate(v), source: 'date' };
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return { iso: isoFromDate(new Date(ms)), source: 'date' };
  }
  const s = text(v).toUpperCase().replace(/^DATE[:\s]*/, '');
  let m = s.match(/^([A-Z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![1].slice(0, 3)));
    if (mi >= 0) return { iso: validIso(Number(m[3]), mi + 1, Number(m[2])), source: 'text' };
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return { iso: validIso(Number(m[3]), Number(m[1]), Number(m[2])), source: 'text' };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { iso: validIso(Number(m[1]), Number(m[2]), Number(m[3])), source: 'text' };
  return { iso: null, source: null };
}

function num(v: CellValue): number | null {
  if (v === null || v === '' || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[₱,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function findDateAbove(g: Grid, row: number, cols: number[], maxUp: number): { iso: string | null; title: string; at: string } {
  for (let r = row - 1; r >= Math.max(1, row - maxUp); r--) {
    for (const c of cols) {
      const v = g.value(r, c);
      if (v === null || v === '') continue;
      const t = text(v);
      if (/^SY[:\s]/i.test(t) || /REPORT|SALES|EXPENSES|DEPARTMENT|REPUBLIC|REGION|DIVISION|SCHOOL/i.test(t)) continue;
      const p = parseDate(v);
      if (p.iso) return { iso: p.iso, title: t, at: addr(r, c) };
    }
  }
  return { iso: null, title: '', at: '' };
}

function isStopRow(g: Grid, row: number, cols: number[]): boolean {
  return cols.some((c) => /^(PREPARED BY|NOTED BY|REPUBLIC OF THE PHILIPPINES)/.test(norm(g.value(row, c))));
}

function findHeaders(g: Grid, test: (r: number, c: number) => boolean): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let r = 1; r <= g.rowCount; r++) {
    for (let c = 1; c <= g.colCount; c++) {
      if (test(r, c)) out.push({ row: r, col: c });
    }
  }
  return out;
}

// ------------------------------------------------------------ DAILY SALES
// Block columns (relative to ITEM column c):
// c-1 NO. | c ITEM | c+1 CONSIGNEE | c+2 TOTAL QUANTITY | c+3 PRICE PER PIECE |
// c+4 SOLD Quantity | c+5 SOLD Amount* | c+6 UNSOLD Quantity* | c+7 UNSOLD Amount* | c+8 SHARE*
// (* = formula columns, used only for cross-checking)
export function parseDailySales(g: Grid): ParseResult {
  const headers = findHeaders(
    g,
    (r, c) => norm(g.value(r, c)) === 'ITEM' && norm(g.value(r, c - 1)).startsWith('NO') && norm(g.value(r, c + 1)) === 'CONSIGNEE',
  );
  const rows: StagedRow[] = [];
  const blocks: BlockSummary[] = [];
  const warnings: string[] = [];
  const seenDates = new Map<string, string>();

  for (const h of headers) {
    const c = h.col;
    const date = findDateAbove(g, h.row, [c - 1, c, c + 1], 4);
    const blockRows: StagedRow[] = [];
    let lineNo = 0;
    for (let r = h.row + 2; r <= Math.min(g.rowCount, h.row + 70); r++) {
      if (isStopRow(g, r, [c - 1, c, c + 1, c + 4])) break;
      const name = text(g.value(r, c));
      const consignee = text(g.value(r, c + 1));
      const total = num(g.value(r, c + 2));
      const price = num(g.value(r, c + 3));
      const sold = num(g.value(r, c + 4));
      const wbAmount = num(g.value(r, c + 5));
      const wbShare = num(g.value(r, c + 8));
      if (!name && total === null && sold === null && price === null) continue; // blank row

      const messages: string[] = [];
      let status: RowStatus = 'valid';
      const ref = `${g.name}!${addr(r, c)}`;
      if (!name) {
        status = 'invalid';
        messages.push('Item name is blank.');
      }
      for (const [label, v] of [['Total quantity', total], ['Price per piece', price], ['Sold quantity', sold]] as const) {
        if (v !== null && Number.isNaN(v)) {
          status = 'invalid';
          messages.push(`${label} is not a number.`);
        } else if (v !== null && v < 0) {
          status = 'invalid';
          messages.push(`${label} is negative.`);
        }
      }
      if (price === null && status !== 'invalid') {
        status = 'invalid';
        messages.push('Price per piece is missing.');
      }
      const t = total ?? 0;
      const s = sold ?? 0;
      const share = wbShare ?? s;
      if (status === 'valid' && s > t) {
        status = 'review';
        messages.push(`Sold (${s}) is more than total quantity (${t}); the workbook shows a negative unsold quantity. Correct the quantities before importing.`);
      }
      if (status === 'valid' && t === 0 && s === 0) {
        status = 'skipped';
        messages.push('No quantity offered on this day (0 / 0). Skipped by default; mark as valid to keep it.');
      }
      if (price !== null && !Number.isNaN(price) && wbAmount !== null && !Number.isNaN(wbAmount) && r2(wbAmount) !== r2(s * price)) {
        messages.push(`Workbook amount ${wbAmount} ≠ recalculated ${r2(s * price)}; the recalculated value will be used.`);
      }
      if (wbShare !== null && wbShare !== s) {
        messages.push(`Workbook SHARE (${wbShare}) differs from SOLD (${s}); the workbook SHARE value is kept.`);
      }
      if (!date.iso) {
        if (status === 'valid') status = 'review';
        messages.push('The date title above this block could not be read. Set the sale date before importing.');
      }
      lineNo += 1;
      blockRows.push({
        row_ref: ref,
        group_key: date.iso ?? `unknown@${addr(h.row, c)}`,
        status,
        messages,
        raw: { item: name, consignee, total, price, sold, amount: wbAmount, share: wbShare, date_title: date.title },
        mapped: {
          sale_date: date.iso,
          line_no: lineNo,
          item_name: name,
          consignee: consignee || null,
          total_quantity: t,
          unit_price: price !== null && !Number.isNaN(price) ? price : null,
          sold_quantity: s,
          share_quantity: share,
        },
      });
    }

    if (blockRows.length === 0) continue; // empty template block
    const key = date.iso ?? `unknown@${addr(h.row, c)}`;
    if (date.iso && seenDates.has(date.iso)) {
      warnings.push(`Two blocks are titled ${date.title} (${seenDates.get(date.iso)} and ${addr(h.row, c)}). The second block is marked for review.`);
      blockRows.forEach((x) => {
        if (x.status === 'valid') x.status = 'review';
        x.messages.push('Another block in this sheet has the same date.');
      });
    }
    if (date.iso) seenDates.set(date.iso, addr(h.row, c));

    const included = blockRows.filter((x) => x.status !== 'skipped' && x.status !== 'invalid');
    const recalcAmount = r2(included.reduce((a, x) => a + Number(x.mapped.sold_quantity) * Number(x.mapped.unit_price ?? 0), 0));
    const recalcShare = included.reduce((a, x) => a + Number(x.mapped.share_quantity), 0);
    const wbAmountTotal = num(g.value(h.row, c + 5));
    const wbShareTotal = num(g.value(h.row, c + 8));
    blocks.push({
      key,
      date: date.iso,
      title: date.title || '(no date title)',
      anchor: `${g.name}!${addr(h.row, c)}`,
      rowCount: blockRows.length,
      checks: [
        { label: 'Total sales amount', workbook: wbAmountTotal, recalculated: recalcAmount, ok: wbAmountTotal === null || r2(wbAmountTotal) === recalcAmount },
        { label: 'Total share (Daily Canteen Shares)', workbook: wbShareTotal, recalculated: recalcShare, ok: wbShareTotal === null || wbShareTotal === recalcShare },
      ],
    });
    rows.push(...blockRows);
  }
  if (headers.length === 0) warnings.push('No DAILY SALES blocks (NO. | ITEM | CONSIGNEE header) were found in this sheet.');
  return { target: 'daily_sales', rows, blocks, warnings };
}

// ------------------------------------------------- EXPENSES & OTHER SALES
// Block columns: c-1 NO. | c ITEM | c+1 NATURE OF ITEM | c+2 REQUESTED OR GIVEN BY | c+3 AMOUNT
const TYPE_MAP: Record<string, 'sale' | 'expense' | 'deficit'> = {
  SALE: 'sale',
  SALES: 'sale',
  'OTHER SALE': 'sale',
  EXPENSE: 'expense',
  EXPENSES: 'expense',
  DEFICIT: 'deficit',
};

export function suggestCategory(type: string | null, description: string): string | null {
  const d = description.toLowerCase();
  if (type === 'sale') return /canteen share/.test(d) ? 'Canteen Share' : 'Canteen Product Sale';
  if (type === 'deficit') return null;
  if (type !== 'expense') return null;
  if (/salary|wage|sweldo/.test(d)) return 'Salaries & Wages';
  if (/transpo|fare|pamasahe|gas\b|gasoline/.test(d)) return 'Transportation';
  if (/gallon|water|electric|kuryente/.test(d) && !/plastic/.test(d)) return 'Water & Utilities';
  if (/plastic|cup|styro|bag|straw|container/.test(d)) return 'Packaging & Disposables';
  if (/rice|bigas|oil|sugar|salt|egg|meat|fish|vegetable|ingredient/.test(d)) return 'Ingredients & Food Supplies';
  return null;
}

export function parseExpensesAndOtherSales(g: Grid): ParseResult {
  const headers = findHeaders(
    g,
    (r, c) => norm(g.value(r, c)) === 'ITEM' && norm(g.value(r, c + 1)).startsWith('NATURE') && /AMOUNT/.test(norm(g.value(r, c + 3))),
  );
  const rows: StagedRow[] = [];
  const blocks: BlockSummary[] = [];
  const warnings: string[] = [];
  const occurrences = new Map<string, number>();

  for (const h of headers) {
    const c = h.col;
    const date = findDateAbove(g, h.row, [c - 1, c, c + 1], 9);
    const blockRows: StagedRow[] = [];
    for (let r = h.row + 1; r <= Math.min(g.rowCount, h.row + 80); r++) {
      if (isStopRow(g, r, [c - 1, c, c + 1, c + 2])) break;
      const description = text(g.value(r, c));
      const natureRaw = text(g.value(r, c + 1));
      const requestedBy = text(g.value(r, c + 2));
      const amount = num(g.value(r, c + 3));
      if (!description && !natureRaw && !requestedBy && amount === null) continue; // blank template row

      const messages: string[] = [];
      let status: RowStatus = 'valid';
      const type = TYPE_MAP[natureRaw.toUpperCase()] ?? null;
      if (!description) {
        status = 'invalid';
        messages.push('Item / description is blank.');
      }
      if (!type) {
        status = status === 'invalid' ? 'invalid' : 'review';
        messages.push(`Nature of item "${natureRaw || '(blank)'}" is not Sale, Expense or Deficit. Choose the correct type.`);
      }
      if (amount === null) {
        status = 'invalid';
        messages.push('Amount is blank.');
      } else if (Number.isNaN(amount) || amount <= 0) {
        status = 'invalid';
        messages.push('Amount must be a number greater than zero.');
      }
      if (!date.iso) {
        if (status === 'valid') status = 'review';
        messages.push('The date title above this block could not be read. Set the transaction date before importing.');
      }
      const base = [date.iso, type, description.toLowerCase(), requestedBy.toLowerCase(), amount].join('|');
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      if (occurrence > 1) messages.push(`Identical entry #${occurrence} on the same day — kept as a separate transaction. Verify it is not a double entry.`);

      blockRows.push({
        row_ref: `${g.name}!${addr(r, c)}`,
        group_key: date.iso ?? undefined,
        status,
        messages,
        raw: { item: description, nature: natureRaw, requested_by: requestedBy, amount, date_title: date.title },
        mapped: {
          transaction_date: date.iso,
          transaction_type: type,
          description,
          requested_by: requestedBy || null,
          amount: amount !== null && !Number.isNaN(amount) ? amount : null,
          category: suggestCategory(type, description),
          occurrence,
        },
      });
    }
    if (blockRows.length === 0) continue;

    const sumBy = (t: string) =>
      r2(blockRows.filter((x) => x.mapped.transaction_type === t && x.status !== 'invalid').reduce((a, x) => a + Number(x.mapped.amount ?? 0), 0));
    // The block's own SUMIF totals sit in the rows above the header: label in c+2, value in c+3.
    const wbTotal = (label: string) => {
      for (let r = h.row - 1; r >= Math.max(1, h.row - 5); r--) {
        if (norm(g.value(r, c + 2)) === label) return num(g.value(r, c + 3)) ?? 0;
      }
      return null;
    };
    blocks.push({
      key: date.iso ?? `unknown@${addr(h.row, c)}`,
      date: date.iso,
      title: date.title || '(no date title)',
      anchor: `${g.name}!${addr(h.row, c)}`,
      rowCount: blockRows.length,
      checks: (['SALE', 'EXPENSE', 'DEFICIT'] as const).map((label) => {
        const wb = wbTotal(label);
        const re = sumBy(label.toLowerCase());
        return { label: `${label[0]}${label.slice(1).toLowerCase()} total`, workbook: wb, recalculated: re, ok: wb === null || r2(wb) === re };
      }),
    });
    rows.push(...blockRows);
  }
  if (headers.length === 0) warnings.push('No EXPENSES & OTHER SALES blocks (ITEM | NATURE OF ITEM | … | AMOUNT header) were found.');
  return { target: 'financial_transactions', rows, blocks, warnings };
}

// ---------------------------------------------------------------- SUMMARY
/** Map 'DAILY SALES'!J15 style references → date of the block holding that cell. */
export type BlockDateLookup = (sheet: string, ref: string) => string | null;

export function buildBlockDateLookup(daily: ParseResult | null, expenses: ParseResult | null): BlockDateLookup {
  const entries: { sheet: string; row: number; col: number; date: string; span: number }[] = [];
  const collect = (res: ParseResult | null, span: number) => {
    res?.blocks.forEach((b) => {
      if (!b.date) return;
      const [sheet, cell] = b.anchor.split('!');
      const m = cell.match(/^([A-Z]+)(\d+)$/)!;
      entries.push({ sheet: sheet.toUpperCase(), row: Number(m[2]), col: colIndex(m[1]), date: b.date, span });
    });
  };
  collect(daily, 10);
  collect(expenses, 5);
  return (sheet, ref) => {
    const m = ref.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    const row = Number(m[2]);
    const col = colIndex(m[1]);
    const candidates = entries.filter(
      (e) => e.sheet === sheet.toUpperCase() && col >= e.col - 1 && col < e.col - 1 + e.span && row <= e.row + 2 && row >= e.row - 8,
    );
    candidates.sort((a, b) => Math.abs(a.row - row) - Math.abs(b.row - row));
    return candidates[0]?.date ?? null;
  };
}

function formulaRef(f: string | null): { sheet: string; ref: string } | null {
  if (!f) return null;
  const m = f.match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/);
  return m ? { sheet: m[1], ref: `${m[2]}${m[3]}` } : null;
}

export function parseSummary(g: Grid, lookup?: BlockDateLookup): { references: ParseResult; carryovers: ParseResult } {
  const refRows: StagedRow[] = [];
  const carryRows: StagedRow[] = [];
  const warnings: string[] = [];
  const header = findHeaders(
    g,
    (r, c) => norm(g.value(r, c)) === 'DATE' && norm(g.value(r, c - 1)).startsWith('NO') && norm(g.value(r, c + 1)) === 'ACTUAL MONEY',
  )[0];

  if (header) {
    const c = header.col; // DATE column
    for (let r = header.row + 1; r <= Math.min(g.rowCount, header.row + 80); r++) {
      const dateCell = g.value(r, c);
      if (dateCell === null || dateCell === '') {
        if (norm(g.value(r, c)) === 'SUMMARY' || norm(g.value(r + 1, c)) === 'SUMMARY') break;
        continue;
      }
      if (norm(dateCell) === 'SUMMARY') break;
      const parsed = parseDate(dateCell);
      const messages: string[] = [];
      let status: RowStatus = 'valid';
      // The SHARES / OTHER SHARES cells are formulas pointing at the day's
      // block; that block's date title is the most reliable date.
      const refD = formulaRef(g.formula(r, c + 2));
      const refE = formulaRef(g.formula(r, c + 3));
      const linked = (refD && lookup?.(refD.sheet, refD.ref)) || (refE && lookup?.(refE.sheet, refE.ref)) || null;
      let iso = parsed.iso;
      if (linked && parsed.iso !== linked) {
        messages.push(
          `Typed date ${text(dateCell)} reads as ${parsed.iso ?? 'invalid'} but this row links to the block dated ${linked} (likely a day/month swap). Using ${linked}.`,
        );
        iso = linked;
      } else if (!parsed.iso) {
        status = 'review';
        messages.push(`Date "${text(dateCell)}" could not be read.`);
      }
      const v = (k: number) => {
        const n = num(g.value(r, c + k));
        return n === null || Number.isNaN(n) ? null : n;
      };
      const mapped = {
        report_date: iso,
        actual_money: v(1),
        daily_canteen_shares: v(2),
        other_shares: v(3),
        gross_sales: v(4),
        expenses: v(5),
        deficit: v(6),
        net_sales: v(7),
      };
      const allEmpty = [mapped.actual_money, mapped.daily_canteen_shares, mapped.other_shares, mapped.expenses, mapped.deficit].every((x) => x === null);
      if (allEmpty) {
        status = 'skipped';
        messages.push('Row has a date but no figures.');
      }
      messages.push('Workbook figures are kept for reconciliation only; reports are recalculated from the imported daily sales and transactions.');
      refRows.push({ row_ref: `${g.name}!${addr(r, c)}`, status, messages, raw: { date: text(dateCell) }, mapped });
    }
  } else {
    warnings.push('The CONSOLIDATED DAILY CANTEEN REPORT table (NO. | DATE | ACTUAL MONEY …) was not found.');
  }

  // "SUMMARY" box: constant cash amounts (carry-overs). Formula rows are recalculated, never imported.
  const box = findHeaders(g, (r, c) => norm(g.value(r, c)) === 'SUMMARY' && g.formula(r, c) === null)[0];
  if (box) {
    for (let r = box.row + 1; r <= Math.min(g.rowCount, box.row + 20); r++) {
      const label = text(g.value(r, box.col));
      if (!label) break;
      const valueCol = box.col + 1;
      if (g.formula(r, valueCol) !== null) continue;
      const amount = num(g.value(r, valueCol));
      if (amount === null || Number.isNaN(amount) || amount <= 0) continue;
      carryRows.push({
        row_ref: `${g.name}!${addr(r, valueCol)}`,
        status: 'review',
        messages: [
          'Cash carried over into the canteen fund (not a sale). Set the date it applies to, then mark it valid.',
        ],
        raw: { label, amount },
        mapped: { entry_date: null, description: label, amount },
      });
    }
  }

  return {
    references: { target: 'summary_reference', rows: refRows, blocks: [], warnings },
    carryovers: { target: 'cash_carryovers', rows: carryRows, blocks: [], warnings: [] },
  };
}

// -------------------------------------------------------- generic tables
export interface GenericMapping {
  headerRow: number;
  date?: number;
  description?: number;
  type?: number;
  requestedBy?: number;
  amount?: number;
  fixedType?: 'sale' | 'expense' | 'deficit';
  fixedDate?: string;
}

/** Any other sheet that lists expenses / other sales one per row. */
export function parseGenericTransactions(g: Grid, map: GenericMapping): ParseResult {
  const rows: StagedRow[] = [];
  const occurrences = new Map<string, number>();
  let blankStreak = 0;
  for (let r = map.headerRow + 1; r <= g.rowCount && blankStreak < 20; r++) {
    const description = map.description ? text(g.value(r, map.description)) : '';
    const amountV = map.amount ? num(g.value(r, map.amount)) : null;
    const dateV = map.date ? parseDate(g.value(r, map.date)) : { iso: map.fixedDate ?? null };
    const typeRaw = map.type ? text(g.value(r, map.type)) : '';
    if (!description && amountV === null) {
      blankStreak++;
      continue;
    }
    blankStreak = 0;
    const type = map.fixedType ?? TYPE_MAP[typeRaw.toUpperCase()] ?? null;
    const messages: string[] = [];
    let status: RowStatus = 'valid';
    if (!description) { status = 'invalid'; messages.push('Description is blank.'); }
    if (amountV === null || Number.isNaN(amountV) || amountV <= 0) { status = 'invalid'; messages.push('Amount must be greater than zero.'); }
    if (!dateV.iso) { if (status === 'valid') status = 'review'; messages.push('Date missing or unreadable.'); }
    if (!type) { if (status === 'valid') status = 'review'; messages.push(`Type "${typeRaw}" is not Sale, Expense or Deficit.`); }
    const requestedBy = map.requestedBy ? text(g.value(r, map.requestedBy)) : '';
    const base = [dateV.iso, type, description.toLowerCase(), requestedBy.toLowerCase(), amountV].join('|');
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    rows.push({
      row_ref: `${g.name}!${addr(r, map.description ?? 1)}`,
      status,
      messages,
      raw: { description, type: typeRaw, amount: amountV, requested_by: requestedBy },
      mapped: {
        transaction_date: dateV.iso,
        transaction_type: type,
        description,
        requested_by: requestedBy || null,
        amount: amountV !== null && !Number.isNaN(amountV) ? amountV : null,
        category: suggestCategory(type, description),
        occurrence,
      },
    });
  }
  return { target: 'financial_transactions', rows, blocks: [], warnings: rows.length === 0 ? ['No data rows found below the header row.'] : [] };
}

export function detectSheetKind(g: Grid): 'daily_sales' | 'expenses' | 'summary' | 'funds' | 'generic' {
  const up = g.name.toUpperCase();
  if (up.includes('DAILY SALES')) return 'daily_sales';
  if (up.includes('EXPENSES')) return 'expenses';
  if (up.includes('SUMMARY')) return 'summary';
  if (up.includes('FUND')) return 'funds';
  return 'generic';
}

// ------------------------------------------------------- product list
export interface DerivedProduct {
  key: string;
  name: string;
  consignee: string | null;
  selling_price: number;
  prices: number[];
  lastSeen: string | null;
  days: number;
  /** Spellings merged into this product (e.g. "Bola bola" / "Bola-bola"). */
  spellings: string[];
  /** Name of a very similar product from the same consignee (likely a typo). */
  possibleDuplicateOf: string | null;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // a swapped pair of letters ("Biscutis" / "Biscuits") counts as one typo
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * One product per item + consignee from the DAILY SALES blocks, using the
 * price from the most recent day it appears. Price changes are kept so the
 * administrator can review them.
 */
export function deriveProductList(daily: ParseResult): DerivedProduct[] {
  const map = new Map<string, DerivedProduct>();
  for (const r of daily.rows) {
    if (r.status === 'invalid') continue;
    const name = String(r.mapped.item_name ?? '').trim();
    const price = r.mapped.unit_price;
    if (!name || typeof price !== 'number') continue;
    const consignee = (r.mapped.consignee as string | null)?.trim() || null;
    const key = `${normName(name)}|${normName(consignee ?? '')}`;
    const date = (r.mapped.sale_date as string | null) ?? null;
    const p = map.get(key) ?? { key, name, consignee, selling_price: price, prices: [], lastSeen: null, days: 0, spellings: [], possibleDuplicateOf: null };
    p.days += 1;
    if (!p.spellings.includes(name)) p.spellings.push(name);
    if (!p.prices.includes(price)) p.prices.push(price);
    if (date && (!p.lastSeen || date >= p.lastSeen)) {
      p.lastSeen = date;
      p.selling_price = price;
      p.name = name;
    }
    map.set(key, p);
  }
  const list = [...map.values()];
  // flag near-identical names from the same consignee; keep the one used on more days
  for (const a of list) {
    for (const b of list) {
      if (a === b || a.possibleDuplicateOf || (a.consignee ?? '') !== (b.consignee ?? '')) continue;
      const [na, nb] = [normName(a.name), normName(b.name)];
      const close = editDistance(na, nb) <= Math.max(1, Math.floor(Math.min(na.length, nb.length) / 6));
      if (close && (a.days < b.days || (a.days === b.days && a.name > b.name))) a.possibleDuplicateOf = b.name;
    }
  }
  return list.sort((a, b) => (a.consignee ?? '').localeCompare(b.consignee ?? '') || a.name.localeCompare(b.name));
}
