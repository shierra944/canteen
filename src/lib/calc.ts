// Live preview of daily sales maths while typing. The saved values come from
// generated columns in Postgres (daily_sale_items); these formulas mirror them
// exactly and are unit-tested against the workbook's own figures.
import { round2 } from './utils';

export interface LineInput {
  total_quantity: number;
  unit_price: number;
  sold_quantity: number;
  share_quantity: number;
}

export interface LineCalc {
  salesAmount: number; // = Sold × Price
  unsoldQuantity: number; // = Total − Sold
  unsoldAmount: number; // = Unsold × Price
  error: string | null;
}

export function calcLine(l: LineInput): LineCalc {
  const t = Number(l.total_quantity) || 0;
  const s = Number(l.sold_quantity) || 0;
  const p = Number(l.unit_price) || 0;
  let error: string | null = null;
  if (t < 0 || s < 0 || p < 0 || (Number(l.share_quantity) || 0) < 0) error = 'Values cannot be negative.';
  else if (s > t) error = `Sold (${s}) exceeds total quantity (${t}).`;
  return {
    salesAmount: round2(s * p),
    unsoldQuantity: t - s,
    unsoldAmount: round2((t - s) * p),
    error,
  };
}

export interface DailyTotals {
  unitsSold: number;
  salesAmount: number;
  unsoldUnits: number;
  unsoldAmount: number;
  shareUnits: number;
  totalQuantity: number;
}

export function calcTotals(lines: LineInput[]): DailyTotals {
  return lines.reduce<DailyTotals>(
    (acc, l) => {
      const c = calcLine(l);
      acc.unitsSold += Number(l.sold_quantity) || 0;
      acc.totalQuantity += Number(l.total_quantity) || 0;
      acc.salesAmount = round2(acc.salesAmount + c.salesAmount);
      acc.unsoldUnits += c.unsoldQuantity;
      acc.unsoldAmount = round2(acc.unsoldAmount + c.unsoldAmount);
      acc.shareUnits += Number(l.share_quantity) || 0;
      return acc;
    },
    { unitsSold: 0, salesAmount: 0, unsoldUnits: 0, unsoldAmount: 0, shareUnits: 0, totalQuantity: 0 },
  );
}

/** Daily Canteen Shares (₱) = Σ share quantity × share rate (workbook: ₱1 per unit). */
export function canteenShares(shareUnits: number, rate: number): number {
  return round2(shareUnits * rate);
}
