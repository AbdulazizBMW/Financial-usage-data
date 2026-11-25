import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const CURRENCIES = ['UZS', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BASE_CURRENCY_DEFAULT: Currency = 'UZS';

export const ACCOUNT_TYPES = ['cash', 'card', 'bank', 'other'] as const;
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'mobile', 'other'] as const;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

export function dec(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    return new Decimal(value as Decimal.Value);
  } catch {
    return new Decimal(0);
  }
}

/** Exact two-decimal string, ready for NUMERIC(20,2) columns. */
export function money(value: string | number | Decimal | null | undefined): string {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Exact eight-decimal string, ready for NUMERIC(20,8) columns. */
export function rate(value: string | number | Decimal | null | undefined): string {
  return dec(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function parseMonth(value: unknown): { year: number; month: number } {
  const now = new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split('-').map(Number);
    if (m >= 1 && m <= 12 && y >= 1900 && y <= 2200) return { year: y, month: m };
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'this_month',
  'last_month',
  'this_year',
  'custom',
  'all'
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DateRange {
  preset: RangePreset;
  from: string;
  to: string;
}

export function resolveRange(presetRaw: unknown, fromRaw?: unknown, toRaw?: unknown): DateRange {
  const preset = (RANGE_PRESETS as readonly string[]).includes(String(presetRaw))
    ? (presetRaw as RangePreset)
    : 'this_month';
  const today = todayISO();
  const now = new Date(`${today}T00:00:00Z`);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { preset, from: y, to: y };
    }
    case 'last7':
      return { preset, from: addDays(today, -6), to: today };
    case 'this_month': {
      const b = monthBounds(year, month);
      return { preset, ...b };
    }
    case 'last_month': {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { preset, ...monthBounds(y, m) };
    }
    case 'this_year':
      return { preset, from: `${year}-01-01`, to: `${year}-12-31` };
    case 'custom': {
      const from = isValidDate(fromRaw) ? (fromRaw as string) : today;
      const to = isValidDate(toRaw) ? (toRaw as string) : today;
      return from <= to ? { preset, from, to } : { preset, from: to, to: from };
    }
    case 'all':
    default:
      return { preset: 'all', from: '1900-01-01', to: today };
  }
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Percentage as a fixed 2-decimal string; 0 when the denominator is zero. */
export function percent(numerator: Decimal | string | number, denominator: Decimal | string | number): string {
  const den = dec(denominator);
  if (den.isZero()) return '0.00';
  return dec(numerator).div(den).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
