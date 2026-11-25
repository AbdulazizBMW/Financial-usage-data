import { dec, money, percent, addDays, monthBounds, monthLabel, todayISO, type DateRange } from './money.js';
import type { Queryable } from './db.js';

export interface Rates {
  base: string;
  rates: Record<string, string>;
  missing: string[];
}

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  currency: string;
  archived: boolean;
  openingBalance: string;
  balance: string;
  baseBalance: string;
}

export interface TxnRow {
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

export interface CategoryTotal {
  id: string | null;
  name: string;
  total: string;
  count: number;
}

export async function loadRates(q: Queryable, userId: string, base: string): Promise<Rates> {
  const { rows } = await q.query<{ currency: string; rate: string }>(
    `SELECT DISTINCT ON (currency) currency, rate
       FROM fx_rates WHERE user_id = $1
      ORDER BY currency, as_of DESC, created_at DESC`,
    [userId]
  );
  const rates: Record<string, string> = { [base]: '1' };
  for (const row of rows) {
    if (row.currency !== base) rates[row.currency] = money(row.rate);
  }
  const missing = ['UZS', 'USD'].filter((c) => c !== base && !rates[c]);
  return { base, rates, missing };
}

export function rateOf(rates: Rates, currency: string) {
  const value = rates.rates[currency];
  return dec(value && Number(value) > 0 ? value : 1);
}

export async function getUserBase(q: Queryable, userId: string): Promise<string> {
  const { rows } = await q.query<{ base_currency: string }>(`SELECT base_currency FROM users WHERE id = $1`, [userId]);
  return rows[0]?.base_currency ?? 'UZS';
}

export async function accountBalances(
  q: Queryable,
  userId: string,
  rates: Rates,
  asOf: string
): Promise<AccountBalance[]> {
  const { rows } = await q.query<{
    id: string;
    name: string;
    type: string;
    currency: string;
    archived: boolean;
    opening_balance: string;
    account_delta: string;
    base_delta: string;
  }>(
    `SELECT a.id, a.name, a.type, a.currency, a.archived, a.opening_balance,
            COALESCE(SUM(m.account_delta) FILTER (WHERE m.d <= $2), 0) AS account_delta,
            COALESCE(SUM(m.base_delta) FILTER (WHERE m.d <= $2), 0) AS base_delta
       FROM accounts a
       LEFT JOIN v_cash_movements m ON m.account_id = a.id
      WHERE a.user_id = $1
      GROUP BY a.id
      ORDER BY a.created_at ASC, a.name ASC`,
    [userId, asOf]
  );
  return rows.map((row) => {
    const opening = dec(row.opening_balance);
    const balance = opening.plus(dec(row.account_delta));
    const baseBalance = opening.times(rateOf(rates, row.currency)).plus(dec(row.base_delta));
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      archived: row.archived,
      openingBalance: money(opening),
      balance: money(balance),
      baseBalance: money(baseBalance)
    };
  });
}

export function sumBase(accounts: AccountBalance[]): string {
  return money(accounts.reduce((acc, a) => acc.plus(dec(a.baseBalance)), dec(0)));
}

export interface PeriodFlows {
  income: string;
  expenses: string;
  netCashFlow: string;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
}

export async function periodFlows(q: Queryable, userId: string, range: { from: string; to: string }): Promise<PeriodFlows> {
  const { rows } = await q.query<{
    income: string;
    expenses: string;
    income_count: string;
    expense_count: string;
    transfer_count: string;
  }>(
    `SELECT COALESCE(SUM(base_amount) FILTER (WHERE kind = 'income'), 0) AS income,
            COALESCE(SUM(base_amount) FILTER (WHERE kind = 'expense'), 0) AS expenses,
            COUNT(*) FILTER (WHERE kind = 'income') AS income_count,
            COUNT(*) FILTER (WHERE kind = 'expense') AS expense_count,
            COUNT(*) FILTER (WHERE kind = 'transfer') AS transfer_count
       FROM transactions
      WHERE user_id = $1 AND txn_date BETWEEN $2 AND $3`,
    [userId, range.from, range.to]
  );
  const row = rows[0];
  const income = money(row?.income ?? 0);
  const expenses = money(row?.expenses ?? 0);
  return {
    income,
    expenses,
    netCashFlow: money(dec(income).minus(dec(expenses))),
    incomeCount: Number(row?.income_count ?? 0),
    expenseCount: Number(row?.expense_count ?? 0),
    transferCount: Number(row?.transfer_count ?? 0)
  };
}

export interface LoanTotals {
  totalLent: string;
  totalBorrowed: string;
  receivables: string;
  payables: string;
  lentInRange: string;
  borrowedInRange: string;
  repaymentsReceivedInRange: string;
  repaymentsPaidInRange: string;
  lendCount: number;
  borrowCount: number;
  openLendCount: number;
  openBorrowCount: number;
  overdueCount: number;
}

export async function loanTotals(
  q: Queryable,
  userId: string,
  range: { from: string; to: string }
): Promise<LoanTotals> {
  const totals = await q.query<{
    total_lent: string;
    total_borrowed: string;
    receivables: string;
    payables: string;
    lend_count: string;
    borrow_count: string;
    open_lend: string;
    open_borrow: string;
    overdue: string;
  }>(
    `WITH paid AS (
       SELECT loan_id, SUM(base_amount) AS paid_base FROM loan_payments WHERE user_id = $1 GROUP BY loan_id
     )
     SELECT
       COALESCE(SUM(CASE WHEN l.direction = 'lend' THEN l.base_amount ELSE 0 END), 0) AS total_lent,
       COALESCE(SUM(CASE WHEN l.direction = 'borrow' THEN l.base_amount ELSE 0 END), 0) AS total_borrowed,
       COALESCE(SUM(CASE WHEN l.direction = 'lend' THEN l.base_amount - COALESCE(p.paid_base, 0) ELSE 0 END), 0) AS receivables,
       COALESCE(SUM(CASE WHEN l.direction = 'borrow' THEN l.base_amount - COALESCE(p.paid_base, 0) ELSE 0 END), 0) AS payables,
       COUNT(*) FILTER (WHERE l.direction = 'lend') AS lend_count,
       COUNT(*) FILTER (WHERE l.direction = 'borrow') AS borrow_count,
       COUNT(*) FILTER (WHERE l.direction = 'lend' AND l.base_amount - COALESCE(p.paid_base, 0) > 0) AS open_lend,
       COUNT(*) FILTER (WHERE l.direction = 'borrow' AND l.base_amount - COALESCE(p.paid_base, 0) > 0) AS open_borrow,
       COUNT(*) FILTER (WHERE l.due_date IS NOT NULL AND l.due_date < CURRENT_DATE
                        AND l.base_amount - COALESCE(p.paid_base, 0) > 0) AS overdue
     FROM loans l LEFT JOIN paid p ON p.loan_id = l.id
     WHERE l.user_id = $1`,
    [userId]
  );
  const flows = await q.query<{ lent: string; borrowed: string }>(
    `SELECT COALESCE(SUM(base_amount) FILTER (WHERE direction = 'lend'), 0) AS lent,
            COALESCE(SUM(base_amount) FILTER (WHERE direction = 'borrow'), 0) AS borrowed
       FROM loans WHERE user_id = $1 AND loan_date BETWEEN $2 AND $3`,
    [userId, range.from, range.to]
  );
  const payments = await q.query<{ received: string; paid: string }>(
    `SELECT COALESCE(SUM(p.base_amount) FILTER (WHERE l.direction = 'lend'), 0) AS received,
            COALESCE(SUM(p.base_amount) FILTER (WHERE l.direction = 'borrow'), 0) AS paid
       FROM loan_payments p JOIN loans l ON l.id = p.loan_id
      WHERE p.user_id = $1 AND p.pay_date BETWEEN $2 AND $3`,
    [userId, range.from, range.to]
  );
  const t = totals.rows[0];
  return {
    totalLent: money(t?.total_lent ?? 0),
    totalBorrowed: money(t?.total_borrowed ?? 0),
    receivables: money(t?.receivables ?? 0),
    payables: money(t?.payables ?? 0),
    lentInRange: money(flows.rows[0]?.lent ?? 0),
    borrowedInRange: money(flows.rows[0]?.borrowed ?? 0),
    repaymentsReceivedInRange: money(payments.rows[0]?.received ?? 0),
    repaymentsPaidInRange: money(payments.rows[0]?.paid ?? 0),
    lendCount: Number(t?.lend_count ?? 0),
    borrowCount: Number(t?.borrow_count ?? 0),
    openLendCount: Number(t?.open_lend ?? 0),
    openBorrowCount: Number(t?.open_borrow ?? 0),
    overdueCount: Number(t?.overdue ?? 0)
  };
}

export async function categoryTotals(
  q: Queryable,
  userId: string,
  range: { from: string; to: string },
  kind: 'income' | 'expense'
): Promise<CategoryTotal[]> {
  const { rows } = await q.query<{ id: string | null; name: string | null; total: string; n: string }>(
    `SELECT c.id, c.name, SUM(t.base_amount) AS total, COUNT(*) AS n
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = $1 AND t.kind = $2 AND t.txn_date BETWEEN $3 AND $4
      GROUP BY c.id, c.name
      ORDER BY SUM(t.base_amount) DESC`,
    [userId, kind, range.from, range.to]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? 'Uncategorised',
    total: money(row.total),
    count: Number(row.n)
  }));
}

export async function dailySeries(q: Queryable, userId: string, range: { from: string; to: string }) {
  const { rows } = await q.query<{ d: string; income: string; expense: string }>(
    `SELECT to_char(txn_date, 'YYYY-MM-DD') AS d,
            COALESCE(SUM(base_amount) FILTER (WHERE kind = 'income'), 0) AS income,
            COALESCE(SUM(base_amount) FILTER (WHERE kind = 'expense'), 0) AS expense
       FROM transactions
      WHERE user_id = $1 AND txn_date BETWEEN $2 AND $3 AND kind <> 'transfer'
      GROUP BY txn_date
      ORDER BY txn_date ASC`,
    [userId, range.from, range.to]
  );
  return rows.map((row) => ({
    date: row.d,
    income: money(row.income),
    expense: money(row.expense),
    net: money(dec(row.income).minus(dec(row.expense)))
  }));
}

export async function currencyFlows(q: Queryable, userId: string, range: { from: string; to: string }) {
  const { rows } = await q.query<{ currency: string; income: string; expense: string }>(
    `SELECT currency,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0) AS income,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0) AS expense
       FROM transactions
      WHERE user_id = $1 AND txn_date BETWEEN $2 AND $3 AND kind <> 'transfer'
      GROUP BY currency
      ORDER BY currency`,
    [userId, range.from, range.to]
  );
  return rows.map((row) => ({
    currency: row.currency,
    income: money(row.income),
    expense: money(row.expense),
    net: money(dec(row.income).minus(dec(row.expense)))
  }));
}

export interface TxnFilters {
  from?: string;
  to?: string;
  kind?: string;
  categoryId?: string;
  accountId?: string;
  search?: string;
  sort?: string;
  limit?: number;
}

export async function listTransactions(q: Queryable, userId: string, f: TxnFilters): Promise<TxnRow[]> {
  const params: unknown[] = [userId];
  const where: string[] = ['t.user_id = $1'];
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (f.from) where.push(`t.txn_date >= ${push(f.from)}`);
  if (f.to) where.push(`t.txn_date <= ${push(f.to)}`);
  if (f.kind && ['income', 'expense', 'transfer'].includes(f.kind)) where.push(`t.kind = ${push(f.kind)}`);
  if (f.categoryId) where.push(`t.category_id = ${push(f.categoryId)}`);
  if (f.accountId) {
    const p = push(f.accountId);
    where.push(`(t.account_id = ${p} OR t.counter_account_id = ${p})`);
  }
  if (f.search) {
    const p = push(`%${f.search}%`);
    where.push(`(t.description ILIKE ${p} OR c.name ILIKE ${p} OR a.name ILIKE ${p})`);
  }
  const sorts: Record<string, string> = {
    date_desc: 't.txn_date DESC, t.created_at DESC',
    date_asc: 't.txn_date ASC, t.created_at ASC',
    amount_desc: 't.base_amount DESC, t.txn_date DESC',
    amount_asc: 't.base_amount ASC, t.txn_date DESC'
  };
  const order = sorts[f.sort ?? 'date_desc'] ?? sorts.date_desc;
  const limit = Math.min(Math.max(Number(f.limit) || 300, 1), 2000);
  const limitParam = push(limit);

  const { rows } = await q.query<TxnRow>(
    `SELECT t.id, t.kind, to_char(t.txn_date, 'YYYY-MM-DD') AS txn_date, t.amount, t.currency, t.fx_rate,
            t.account_id, t.account_amount, t.base_amount, t.category_id,
            c.name AS category_name, c.kind AS category_kind,
            a.name AS account_name, a.currency AS account_currency,
            t.counter_account_id, ca.name AS counter_account_name,
            t.counter_amount, t.counter_base_amount,
            t.description, t.payment_method, t.created_at
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ca ON ca.id = t.counter_account_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT ${limitParam}`,
    params
  );
  return rows;
}

export interface DashboardData {
  range: DateRange;
  baseCurrency: string;
  rates: Rates;
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
  accounts: AccountBalance[];
  byCurrency: { currency: string; income: string; expense: string; net: string }[];
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  recentTransactions: TxnRow[];
  trend: { month: string; label: string; income: string; expense: string; net: string }[];
  counts: { income: number; expense: number; transfer: number };
  warnings: string[];
}

export async function buildDashboard(
  q: Queryable,
  userId: string,
  range: DateRange,
  base: string
): Promise<DashboardData> {
  const rates = await loadRates(q, userId, base);
  const flows = await periodFlows(q, userId, range);
  const loans = await loanTotals(q, userId, range);
  const accounts = await accountBalances(q, userId, rates, range.to);
  const openingAccounts = await accountBalances(q, userId, rates, addDays(range.from, -1));
  const month = monthBounds(Number(todayISO().slice(0, 4)), Number(todayISO().slice(5, 7)));
  const monthFlows = await periodFlows(q, userId, month);

  const trend = await monthlyTrend(q, userId, 6, base);
  const recent = await listTransactions(q, userId, { limit: 8, sort: 'date_desc' });
  const expenseByCategory = await categoryTotals(q, userId, range, 'expense');
  const incomeByCategory = await categoryTotals(q, userId, range, 'income');
  const byCurrency = await currencyFlows(q, userId, range);

  const savings = money(dec(flows.income).minus(dec(flows.expenses)));
  const warnings: string[] = [];
  if (rates.missing.length) {
    warnings.push(
      `No exchange rate is configured for ${rates.missing.join(', ')}. Consolidated totals currently treat those amounts as 1:1 with ${base} until you set a rate in Settings.`
    );
  }

  return {
    range,
    baseCurrency: base,
    rates,
    income: flows.income,
    expenses: flows.expenses,
    netCashFlow: flows.netCashFlow,
    savings,
    savingsRate: percent(savings, flows.income),
    monthlySavingsRate: percent(
      dec(monthFlows.income).minus(dec(monthFlows.expenses)),
      monthFlows.income
    ),
    openingBalance: sumBase(openingAccounts),
    closingBalance: sumBase(accounts),
    availableBalance: sumBase(accounts),
    totalLent: loans.totalLent,
    totalBorrowed: loans.totalBorrowed,
    receivables: loans.receivables,
    payables: loans.payables,
    overdueCount: loans.overdueCount,
    accounts,
    byCurrency,
    expenseByCategory,
    incomeByCategory,
    recentTransactions: recent,
    trend,
    counts: { income: flows.incomeCount, expense: flows.expenseCount, transfer: flows.transferCount },
    warnings
  };
}

export async function monthlyTrend(q: Queryable, userId: string, months: number, base: string) {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: { month: string; label: string; income: string; expense: string; net: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    const bounds = monthBounds(y, m);
    const flows = await periodFlows(q, userId, bounds);
    out.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      label: monthLabel(y, m).replace(` ${y}`, ''),
      income: flows.income,
      expense: flows.expenses,
      net: flows.netCashFlow
    });
  }
  return out;
}

export interface LoanWithProgress {
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

export async function listLoans(
  q: Queryable,
  userId: string,
  direction: 'lend' | 'borrow',
  filters: { status?: string; search?: string } = {}
): Promise<LoanWithProgress[]> {
  const params: unknown[] = [userId, direction];
  const where = ['l.user_id = $1', 'l.direction = $2'];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(l.counterparty ILIKE $${params.length} OR l.description ILIKE $${params.length})`);
  }
  const { rows } = await q.query<{
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
    payment_count: string;
  }>(
    `SELECT l.id, l.direction, l.counterparty, l.amount, l.currency, l.fx_rate, l.base_amount,
            l.account_id, a.name AS account_name,
            to_char(l.loan_date, 'YYYY-MM-DD') AS loan_date,
            to_char(l.due_date, 'YYYY-MM-DD') AS due_date,
            l.description, l.notes,
            COALESCE(p.paid, 0) AS repaid, COALESCE(p.paid_base, 0) AS repaid_base,
            COALESCE(p.cnt, 0) AS payment_count
       FROM loans l
       JOIN accounts a ON a.id = l.account_id
       LEFT JOIN (
         SELECT loan_id, SUM(amount) AS paid, SUM(base_amount) AS paid_base, COUNT(*) AS cnt
           FROM loan_payments WHERE user_id = $1 GROUP BY loan_id
       ) p ON p.loan_id = l.id
      WHERE ${where.join(' AND ')}
      ORDER BY l.loan_date DESC, l.created_at DESC`,
    params
  );
  const today = todayISO();
  const mapped = rows.map((row) => {
    const outstanding = dec(row.amount).minus(dec(row.repaid));
    const outstandingBase = dec(row.base_amount).minus(dec(row.repaid_base));
    let status: LoanWithProgress['status'] = 'active';
    if (outstandingBase.lte(0.004)) status = 'fully_repaid';
    else if (row.due_date && row.due_date < today) status = 'overdue';
    else if (dec(row.repaid).gt(0)) status = 'partially_repaid';
    return {
      ...row,
      outstanding: money(outstanding.lt(0) ? 0 : outstanding),
      outstanding_base: money(outstandingBase.lt(0) ? 0 : outstandingBase),
      status,
      payment_count: Number(row.payment_count)
    } as LoanWithProgress;
  });
  if (filters.status && filters.status !== 'all') return mapped.filter((l) => l.status === filters.status);
  return mapped;
}

export async function getLoan(q: Queryable, userId: string, id: string) {
  const { rows } = await q.query<{
    id: string;
    direction: 'lend' | 'borrow';
    counterparty: string;
    amount: string;
    currency: string;
    fx_rate: string;
    base_amount: string;
    account_amount: string;
    account_id: string;
    loan_date: string;
    due_date: string | null;
    description: string;
    notes: string;
    created_at: string;
  }>(
    `SELECT id, direction, counterparty, amount, currency, fx_rate, base_amount, account_amount, account_id,
            to_char(loan_date, 'YYYY-MM-DD') AS loan_date,
            to_char(due_date, 'YYYY-MM-DD') AS due_date,
            description, notes, created_at
       FROM loans WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const loan = rows[0];
  if (!loan) return null;
  const payments = await q.query<{
    id: string;
    pay_date: string;
    amount: string;
    currency: string;
    fx_rate: string;
    base_amount: string;
    account_id: string;
    account_name: string;
    note: string;
    created_at: string;
  }>(
    `SELECT p.id, to_char(p.pay_date, 'YYYY-MM-DD') AS pay_date, p.amount, p.currency, p.fx_rate, p.base_amount,
            p.account_id, a.name AS account_name, p.note, p.created_at
       FROM loan_payments p JOIN accounts a ON a.id = p.account_id
      WHERE p.loan_id = $1 AND p.user_id = $2
      ORDER BY p.pay_date ASC, p.created_at ASC`,
    [id, userId]
  );
  const repaid = payments.rows.reduce((acc, p) => acc.plus(dec(p.amount)), dec(0));
  const repaidBase = payments.rows.reduce((acc, p) => acc.plus(dec(p.base_amount)), dec(0));
  return {
    ...loan,
    payments: payments.rows,
    repaid: money(repaid),
    repaidBase: money(repaidBase),
    outstanding: money(dec(loan.amount).minus(repaid).lt(0) ? 0 : dec(loan.amount).minus(repaid)),
    outstandingBase: money(dec(loan.base_amount).minus(repaidBase).lt(0) ? 0 : dec(loan.base_amount).minus(repaidBase))
  };
}

export interface MonthlyData {
  year: number;
  month: number;
  monthKey: string;
  label: string;
  from: string;
  to: string;
  baseCurrency: string;
  rates: Rates;
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
  accounts: AccountBalance[];
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  daily: { date: string; income: string; expense: string; net: string }[];
  transactions: TxnRow[];
  lendLoans: LoanWithProgress[];
  borrowLoans: LoanWithProgress[];
  trend: { month: string; label: string; income: string; expense: string; net: string }[];
  comparison: { previousLabel: string; income: string; expenses: string; netCashFlow: string };
  warnings: string[];
}

export async function buildMonthly(
  q: Queryable,
  userId: string,
  year: number,
  month: number,
  base: string
): Promise<MonthlyData> {
  const bounds = monthBounds(year, month);
  const rates = await loadRates(q, userId, base);
  const flows = await periodFlows(q, userId, bounds);
  const loans = await loanTotals(q, userId, bounds);
  const accounts = await accountBalances(q, userId, rates, bounds.to);
  const openingAccounts = await accountBalances(q, userId, rates, addDays(bounds.from, -1));
  const incomeByCategory = await categoryTotals(q, userId, bounds, 'income');
  const expenseByCategory = await categoryTotals(q, userId, bounds, 'expense');
  const daily = await dailySeries(q, userId, bounds);
  const transactions = await listTransactions(q, userId, { from: bounds.from, to: bounds.to, limit: 1000 });
  const lendLoans = await listLoans(q, userId, 'lend');
  const borrowLoans = await listLoans(q, userId, 'borrow');
  const trend = await monthlyTrend(q, userId, 6, base);

  const prevTotal = year * 12 + (month - 1) - 1;
  const prevYear = Math.floor(prevTotal / 12);
  const prevMonth = (prevTotal % 12) + 1;
  const prevFlows = await periodFlows(q, userId, monthBounds(prevYear, prevMonth));

  const savings = money(dec(flows.income).minus(dec(flows.expenses)));
  const closing = sumBase(accounts);
  const opening = sumBase(openingAccounts);
  const otherCash = money(
    dec(closing)
      .minus(opening)
      .minus(dec(flows.netCashFlow))
      .minus(dec(loans.borrowedInRange))
      .plus(dec(loans.lentInRange))
      .plus(dec(loans.repaymentsReceivedInRange))
      .minus(dec(loans.repaymentsPaidInRange))
  );

  const warnings: string[] = [];
  if (rates.missing.length) {
    warnings.push(
      `No exchange rate is configured for ${rates.missing.join(', ')}. Consolidated totals treat those amounts as 1:1 with ${base}.`
    );
  }

  return {
    year,
    month,
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    label: monthLabel(year, month),
    from: bounds.from,
    to: bounds.to,
    baseCurrency: base,
    rates,
    income: flows.income,
    expenses: flows.expenses,
    netCashFlow: flows.netCashFlow,
    openingBalance: opening,
    closingBalance: closing,
    savings,
    savingsRate: percent(savings, flows.income),
    lentInMonth: loans.lentInRange,
    borrowedInMonth: loans.borrowedInRange,
    repaymentsReceived: loans.repaymentsReceivedInRange,
    repaymentsPaid: loans.repaymentsPaidInRange,
    otherCashMovements: otherCash,
    receivables: loans.receivables,
    payables: loans.payables,
    accounts,
    incomeByCategory,
    expenseByCategory,
    daily,
    transactions,
    lendLoans,
    borrowLoans,
    trend,
    comparison: {
      previousLabel: monthLabel(prevYear, prevMonth),
      income: prevFlows.income,
      expenses: prevFlows.expenses,
      netCashFlow: prevFlows.netCashFlow
    },
    warnings
  };
}
