import { describe, expect, it } from 'vitest';
import { calcLine, calcTotals, canteenShares } from '../../src/lib/calc';
import { round2 } from '../../src/lib/utils';

describe('daily sales line maths (workbook DAILY SALES, March 2 2026)', () => {
  it('matches workbook rows', () => {
    // Hot cake | Judy Ann | 37 | 10 | sold 28 → 280 | unsold 9 → 90 | share 28
    expect(calcLine({ total_quantity: 37, unit_price: 10, sold_quantity: 28, share_quantity: 28 })).toEqual({
      salesAmount: 280,
      unsoldQuantity: 9,
      unsoldAmount: 90,
      error: null,
    });
    // Manok | Jean | 200 | 11 | sold 169 → 1859 | unsold 31 → 341
    const m = calcLine({ total_quantity: 200, unit_price: 11, sold_quantity: 169, share_quantity: 169 });
    expect([m.salesAmount, m.unsoldQuantity, m.unsoldAmount]).toEqual([1859, 31, 341]);
  });

  it('rejects sold > total (workbook Turon Saging 37 of 30)', () => {
    expect(calcLine({ total_quantity: 30, unit_price: 15, sold_quantity: 37, share_quantity: 37 }).error).toMatch(/exceeds/);
  });

  it('totals reconcile with lines and avoid float drift', () => {
    const lines = Array.from({ length: 10 }, () => ({ total_quantity: 3, unit_price: 0.1, sold_quantity: 3, share_quantity: 3 }));
    const t = calcTotals(lines);
    expect(t.salesAmount).toBe(3);
    expect(t.unitsSold).toBe(30);
    expect(t.shareUnits).toBe(30);
  });

  it('computes canteen shares at the configured rate', () => {
    expect(canteenShares(567, 1)).toBe(567);
    expect(canteenShares(3, 0.335)).toBe(1.01);
  });

  it('rounds half away from zero like Postgres', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-2.675)).toBe(-2.68);
  });
});

describe('canteen share and remittance (matches public.v_daily_sale_lines)', async () => {
  const { lineMoney } = await import('../../src/lib/calc');
  const base = { total_quantity: 21, unit_price: 20, sold_quantity: 6, share_quantity: 6 };
  it('consigned with cost price → margin to canteen, cost to consignee', () => {
    expect(lineMoney({ ...base, cost_price: 15, is_canteen_stock: false }, 1)).toEqual({ canteenShare: 30, remit: 90 });
  });
  it('consigned without cost → workbook ₱1 per piece', () => {
    expect(lineMoney({ total_quantity: 37, unit_price: 10, sold_quantity: 28, share_quantity: 28, cost_price: null, is_canteen_stock: false }, 1)).toEqual({ canteenShare: 28, remit: 252 });
  });
  it('canteen stock → all revenue to canteen', () => {
    expect(lineMoney({ ...base, cost_price: null, is_canteen_stock: true }, 1)).toEqual({ canteenShare: 120, remit: 0 });
  });
});
