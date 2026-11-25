export type Currency = 'UZS' | 'USD';

export interface User {
  id: string;
  name: string;
  email: string;
  baseCurrency?: string;
  base_currency?: string;
  theme?: string;
  createdAt?: string;
  created_at?: string;
  recoveryCodeIssued?: boolean;
}

export interface Txn {
  id: string;
  kind: 'income' | 'expense' | 'transfer';
  txn_date: string;
  amount: string;
  currency: string;
  fx_rate: string;
  account_id: string;
  account_amount: string;
  base_amount: string;
  category_id: string | null;
  category_name: string | null;
  category_kind: string | null;
  account_name: string;
  account_currency: string;
  counter_account_id: string | null;
  counter_account_name: string | null;
  counter_amount: string | null;
  counter_base_amount: string | null;
  description: string;
  payment_method: string;
  created_at: string;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  archived: boolean;
  openingBalance: string;
  balance: string;
  baseBalance: string;
  opening_balance?: string;
  opening_date?: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  usageCount?: number;
}

export interface CategoryTotal {
  id: string | null;
  name: string;
  total: string;
  count: number;
}

export interface Loan {
  id: string;
  direction: 'lend' | 'borrow';
  counterparty: string;
  amount: string;
  currency: string;
  fx_rate: string;
  base_amount: string;
  account_id: string;
  account_name: string;
  loan_date: string;
  due_date: string | null;
  description: string;
  notes: string;
  repaid: string;
  repaid_base: string;
  outstanding: string;
  outstanding_base: string;
  status: 'active' | 'partially_repaid' | 'fully_repaid' | 'overdue';
  payment_count: number;
}

export interface LoanPayment {
  id: string;
  loan_id: string;
  pay_date: string;
  amount: string;
  currency: string;
  account_id: string | null;
  account_name?: string | null;
  note: string;
  created_at: string;
}

export interface TrendPoint {
  month: string;
  label: string;
  income: string;
  expense: string;
  net: string;
}

export interface Dashboard {
  range: { preset: string; from: string | null; to: string | null; label: string };
  baseCurrency: string;
  rates: { base: string; rates: Record<string, string>; missing: string[] };
  income: string;
  expenses: string;
  netCashFlow: string;
  savings: string;
  savingsRate: string;
  openingBalance: string;
  closingBalance: string;
  availableBalance: string;
  totalLent: string;
  totalBorrowed: string;
  receivables: string;
  payables: string;
  overdueCount: number;
  monthlySavingsRate: string;
  accounts: Account[];
  byCurrency: { currency: string; income: string; expense: string; net: string }[];
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  recentTransactions: Txn[];
  trend: TrendPoint[];
  counts: { income: number; expense: number; transfer: number };
  warnings: string[];
}

export interface MonthlyData {
  year: number;
  month: number;
  monthKey: string;
  label: string;
  from: string;
  to: string;
  baseCurrency: string;
  rates: { base: string; rates: Record<string, string>; missing: string[] };
  income: string;
  expenses: string;
  netCashFlow: string;
  openingBalance: string;
  closingBalance: string;
  savings: string;
  savingsRate: string;
  lentInMonth: string;
  borrowedInMonth: string;
  repaymentsReceived: string;
  repaymentsPaid: string;
  otherCashMovements: string;
  receivables: string;
  payables: string;
  accounts: Account[];
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  daily: { date: string; income: string; expense: string; net: string }[];
  transactions: Txn[];
  lendLoans: Loan[];
  borrowLoans: Loan[];
  trend: TrendPoint[];
  comparison: { previousLabel: string; income: string; expenses: string; netCashFlow: string };
  warnings: string[];
}

export interface Meta {
  baseCurrency: string;
  currencies: string[];
  accountTypes: string[];
  paymentMethods: string[];
  rates: { base: string; rates: Record<string, string>; missing: string[] };
  storage: { engine: string; durable: boolean; backupStrategy?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Analytics {
  range: { preset: string; from: string | null; to: string | null; label: string };
  baseCurrency: string;
  income: string;
  expenses: string;
  netCashFlow: string;
  savings: string;
  savingsRate: string;
  receivables: string;
  payables: string;
  totalLent: string;
  totalBorrowed?: string;
  [key: string]: unknown;
}

export interface BackupMeta {
  id: string;
  kind: 'auto' | 'manual';
  counts: Record<string, number>;
  sizeKb: string;
  createdAt: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init.headers,
    ...init
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }),

  me: () => api.get<{ user: User }>('/auth/me'),
  login: (email: string, password: string) => api.post<{ user: User }>('/auth/login', { email, password }),
  register: (name: string, email: string, password: string, baseCurrency: string) =>
    api.post<{ user: User; recoveryCode: string }>('/auth/register', { name, email, password, baseCurrency }),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
  forgotPassword: (email: string) =>
    api.post<{ ok: true; mailConfigured: boolean; message: string; resetLink?: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post<{ ok: true }>('/auth/reset-password', { token, password }),
  recover: (email: string, recoveryCode: string, password: string) =>
    api.post<{ ok: true; recoveryCode: string }>('/auth/recover', { email, recoveryCode, password }),

  meta: () => api.get<Meta>('/meta'),
  dashboard: (params: { preset?: string; from?: string; to?: string; base?: string }) =>
    api.get<Dashboard>(`/dashboard${qs(params)}`),
  transactions: (params: {
    preset?: string;
    from?: string;
    to?: string;
    kind?: string;
    categoryId?: string;
    accountId?: string;
    search?: string;
    sort?: string;
    limit?: number;
  }) => api.get<{ range: Dashboard['range']; transactions: Txn[]; summary: Record<string, string | number> }>(`/transactions${qs(params)}`),
  createTransaction: (body: Record<string, unknown>) => api.post<{ transaction: Txn; id: string }>('/transactions', body),
  updateTransaction: (id: string, body: Record<string, unknown>) => api.patch<{ ok: true }>(`/transactions/${id}`, body),
  deleteTransaction: (id: string) => api.del<{ ok: true }>(`/transactions/${id}`),
  transfer: (body: Record<string, unknown>) => api.post<{ ok: true; id: string }>('/transfers', body),

  accounts: () => api.get<{ accounts: Account[]; totalBase: string; baseCurrency: string }>('/accounts'),
  createAccount: (body: Record<string, unknown>) => api.post<{ id: string }>('/accounts', body),
  updateAccount: (id: string, body: Record<string, unknown>) => api.patch<{ ok: true }>(`/accounts/${id}`, body),
  deleteAccount: (id: string) => api.del<{ ok: true }>(`/accounts/${id}`),
  movements: (id: string) =>
    api.get<{ account: Account; movements: { id: string; date: string; description: string; kind: string; amount: string; currency: string; running: string }[] }>(
      `/accounts/${id}/movements`
    ),

  categories: () => api.get<{ categories: Category[] }>('/categories'),
  createCategory: (body: { name: string; kind: string }) => api.post<{ id: string }>('/categories', body),
  updateCategory: (id: string, body: { name: string }) => api.patch<{ ok: true }>(`/categories/${id}`, body),
  deleteCategory: (id: string) => api.del<{ ok: true }>(`/categories/${id}`),

  fxRates: () => api.get<{ baseCurrency: string; latest: Record<string, string>; history: { currency: string; rate: string; as_of: string }[] }>('/fx-rates'),
  saveFxRate: (body: { currency: string; rate: string; asOf?: string }) => api.post<{ ok: true }>('/fx-rates', body),

  settings: (body: Record<string, unknown>) => api.patch<{ user: User }>('/settings', body),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/settings/password', { currentPassword, newPassword }),

  analytics: (params: { preset?: string; from?: string; to?: string }) => api.get<Analytics>(`/analytics${qs(params)}`),
  monthly: (month: string) => api.get<{ monthly: MonthlyData; user: { name: string; email: string } }>(`/reports/monthly.json${qs({ month })}`),

  loans: (direction: 'lend' | 'borrow', params: { status?: string; search?: string } = {}) =>
    api.get<{ loans: Loan[]; totals: Record<string, string>; direction: string }>(`/loans${qs({ direction, ...params })}`),
  loan: (id: string) => api.get<{ loan: Loan; payments: LoanPayment[] }>(`/loans/${id}`),
  createLoan: (body: Record<string, unknown>) => api.post<{ id: string }>('/loans', body),
  updateLoan: (id: string, body: Record<string, unknown>) => api.patch<{ ok: true }>(`/loans/${id}`, body),
  deleteLoan: (id: string) => api.del<{ ok: true }>(`/loans/${id}`),
  addPayment: (id: string, body: Record<string, unknown>) => api.post<{ id: string }>(`/loans/${id}/payments`, body),
  deletePayment: (id: string, paymentId: string) => api.del<{ ok: true }>(`/loans/${id}/payments/${paymentId}`),

  backups: () =>
    api.get<{ backups: BackupMeta[]; retention: { automatic: string; manual: string }; lastBackupAt: string | null }>('/backups'),
  createBackup: () => api.post<{ backup: BackupMeta }>('/backups'),
  deleteBackup: (id: string) => api.del<{ ok: true }>(`/backups/${id}`),
  restoreBackup: (body: { backupId?: string; payload?: unknown }) => api.post<{ ok: true; restored: Record<string, number> }>('/backups/restore', { confirm: true, ...body }),
  audit: () => api.get<{ entries: { id: string; entity: string; action: string; detail: Record<string, unknown>; created_at: string }[] }>('/audit')
};

export const downloadUrl = {
  pdf: (month: string) => `/api/reports/monthly.pdf?month=${encodeURIComponent(month)}`,
  xlsx: (month: string) => `/api/reports/monthly.xlsx?month=${encodeURIComponent(month)}`,
  csv: (month: string) => `/api/reports/transactions.csv?month=${encodeURIComponent(month)}`,
  backup: (id: string) => `/api/backups/${id}/download`
};
