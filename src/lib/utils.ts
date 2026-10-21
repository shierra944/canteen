import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });
const compactPeso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Values from Postgres numeric arrive as strings; never use floats for storage. */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function peso(v: unknown): string {
  return pesoFormatter.format(toNumber(v));
}

export function pesoCompact(v: unknown): string {
  const n = toNumber(v);
  return Math.abs(n) < 10000 ? pesoFormatter.format(n) : compactPeso.format(n);
}

export function qty(v: unknown): string {
  return numberFormatter.format(toNumber(v));
}

/** Round half away from zero to 2 decimals, matching Postgres round(numeric, 2). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  // shift via the decimal string so 2.675 → 267.5 exactly (not 267.4999…)
  const shifted = Math.round(Number(`${Math.abs(n)}e2`));
  return sign * Number(`${shifted}e-2`);
}

/** Today's date in the Philippines as YYYY-MM-DD (matches public.today_ph()). */
export function todayPH(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function parseISODate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDate(d: string | null | undefined, style: 'short' | 'long' | 'medium' = 'medium'): string {
  if (!d) return '—';
  const date = d.length === 10 ? parseISODate(d) : new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : style === 'short'
        ? { month: 'short', day: 'numeric' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-PH', opts).format(date);
}

export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d));
}

export function titleCase(s: string): string {
  return s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
