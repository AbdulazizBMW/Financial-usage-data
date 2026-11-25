export const CURRENCY_SYMBOLS: Record<string, string> = { UZS: 'soʻm', USD: '$' };

export function money(value: unknown, currency = ''): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const numeric = Number(raw ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const formatted = safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function compact(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const abs = Math.abs(safe);
  if (abs >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(safe / 1_000).toFixed(1)}K`;
  return safe.toFixed(0);
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeDays(value: string | null | undefined): string {
  if (!value) return '—';
  const due = new Date(`${value}T00:00:00Z`).getTime();
  const now = new Date(`${todayISO()}T00:00:00Z`).getTime();
  const days = Math.round((due - now) / 86_400_000);
  if (days === 0) return 'due today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
}

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function statusTone(status: string): string {
  switch (status) {
    case 'fully_repaid':
      return 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400';
    case 'partially_repaid':
      return 'bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400';
    case 'overdue':
      return 'bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400';
    default:
      return 'bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:text-brand-300';
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function accountTypeLabel(type: string): string {
  const map: Record<string, string> = { cash: 'Cash', card: 'Bank card', bank: 'Bank account', other: 'Other' };
  return map[type] ?? type;
}

export function paymentLabel(method: string): string {
  const map: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank transfer',
    mobile: 'Mobile payment',
    other: 'Other'
  };
  return map[method] ?? method;
}
