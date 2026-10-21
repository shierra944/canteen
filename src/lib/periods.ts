import { parseISODate, toISODate, todayPH } from './utils';
import type { SchoolYear } from './types';

export type PeriodKey = 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'school_year' | 'custom';

export interface Period {
  key: PeriodKey;
  start: string;
  end: string;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  this_quarter: 'This Quarter',
  school_year: 'This School Year',
  custom: 'Custom Range',
};

/** Resolve a preset relative to a reference date (defaults to today in PH). */
export function resolvePeriod(key: PeriodKey, ref: string = todayPH(), schoolYear?: SchoolYear | null, custom?: { start: string; end: string }): Period {
  const d = parseISODate(ref);
  switch (key) {
    case 'today':
      return { key, start: ref, end: ref };
    case 'this_week': {
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      const start = new Date(d);
      start.setDate(d.getDate() - dow);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { key, start: toISODate(start), end: toISODate(end) };
    }
    case 'this_month':
      return {
        key,
        start: toISODate(new Date(d.getFullYear(), d.getMonth(), 1)),
        end: toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      };
    case 'this_quarter': {
      const q = Math.floor(d.getMonth() / 3);
      return {
        key,
        start: toISODate(new Date(d.getFullYear(), q * 3, 1)),
        end: toISODate(new Date(d.getFullYear(), q * 3 + 3, 0)),
      };
    }
    case 'school_year':
      if (schoolYear) return { key, start: schoolYear.start_date, end: schoolYear.end_date };
      return resolvePeriod('this_month', ref);
    case 'custom':
      return { key, start: custom?.start ?? ref, end: custom?.end ?? ref };
  }
}

export function monthRange(year: number, monthIndex: number): { start: string; end: string } {
  return {
    start: toISODate(new Date(year, monthIndex, 1)),
    end: toISODate(new Date(year, monthIndex + 1, 0)),
  };
}

export function describePeriod(start: string, end: string): string {
  const s = parseISODate(start);
  const e = parseISODate(end);
  const fmt = (x: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-PH', o).format(x);
  if (start === end) return fmt(s, { month: 'long', day: 'numeric', year: 'numeric' });
  const firstOfMonth = s.getDate() === 1;
  const lastOfMonth = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate() === e.getDate();
  if (firstOfMonth && lastOfMonth && s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return fmt(s, { month: 'long', year: 'numeric' }).toUpperCase();
  }
  return `${fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const d = parseISODate(start);
  const e = parseISODate(end);
  while (d <= e && out.length < 800) {
    out.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Week bucket key (Monday start) for chart aggregation. */
export function weekKey(iso: string): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISODate(d);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7) + '-01';
}
