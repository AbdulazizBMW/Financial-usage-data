import type { Queryable } from './db.js';
import { dec } from './money.js';

export interface BackupPayload {
  app: 'finora';
  version: 1;
  generatedAt: string;
  user: { name: string; email: string; baseCurrency: string };
  accounts: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  loans: Record<string, unknown>[];
  loanPayments: Record<string, unknown>[];
  fxRates: Record<string, unknown>[];
}

export async function collectUserBackup(q: Queryable, userId: string): Promise<BackupPayload> {
  const user = await q.query<{ name: string; email: string; base_currency: string }>(
    `SELECT name, email, base_currency FROM users WHERE id = $1`,
    [userId]
  );
  const [accounts, categories, transactions, loans, loanPayments, fxRates] = await Promise.all([
    q.query(`SELECT id, name, type, currency, opening_balance, opening_date, archived, created_at FROM accounts WHERE user_id = $1 ORDER BY created_at`, [userId]),
    q.query(`SELECT id, name, kind, created_at FROM categories WHERE user_id = $1 ORDER BY created_at`, [userId]),
    q.query(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY txn_date, created_at`, [userId]),
    q.query(`SELECT * FROM loans WHERE user_id = $1 ORDER BY loan_date, created_at`, [userId]),
    q.query(`SELECT * FROM loan_payments WHERE user_id = $1 ORDER BY pay_date, created_at`, [userId]),
    q.query(`SELECT currency, rate, as_of FROM fx_rates WHERE user_id = $1 ORDER BY as_of`, [userId])
  ]);
  return {
    app: 'finora',
    version: 1,
    generatedAt: new Date().toISOString(),
    user: user.rows[0]
      ? {
          name: user.rows[0].name,
          email: user.rows[0].email,
          baseCurrency: user.rows[0].base_currency
        }
      : { name: '', email: '', baseCurrency: 'UZS' },
    accounts: accounts.rows,
    categories: categories.rows,
    transactions: transactions.rows,
    loans: loans.rows,
    loanPayments: loanPayments.rows,
    fxRates: fxRates.rows
  };
}

export function backupCounts(payload: BackupPayload): Record<string, number> {
  return {
    accounts: payload.accounts.length,
    categories: payload.categories.length,
    transactions: payload.transactions.length,
    loans: payload.loans.length,
    loanPayments: payload.loanPayments.length,
    fxRates: payload.fxRates.length
  };
}

function asArray(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Backup field "${field}" must be a list.`);
  return value as Record<string, unknown>[];
}

const pick = (row: Record<string, unknown>, keys: string[], defaults: Record<string, unknown> = {}) => {
  const out: Record<string, unknown> = { ...defaults };
  keys.forEach((key) => {
    if (row[key] !== undefined) out[key] = row[key];
  });
  return out;
};

const INSERT_COLUMNS: Record<string, string[]> = {
  categories: ['id', 'name', 'kind'],
  accounts: ['id', 'name', 'type', 'currency', 'opening_balance', 'opening_date', 'archived'],
  transactions: [
    'id',
    'kind',
    'txn_date',
    'amount',
    'currency',
    'fx_rate',
    'account_id',
    'account_amount',
    'base_amount',
    'category_id',
    'counter_account_id',
    'counter_amount',
    'counter_base_amount',
    'description',
    'payment_method',
    'created_at'
  ],
  loans: [
    'id',
    'direction',
    'counterparty',
    'amount',
    'currency',
    'fx_rate',
    'account_amount',
    'base_amount',
    'account_id',
    'loan_date',
    'due_date',
    'description',
    'notes',
    'created_at'
  ],
  loan_payments: ['id', 'loan_id', 'pay_date', 'amount', 'currency', 'fx_rate', 'account_amount', 'base_amount', 'account_id', 'note', 'created_at']
};

async function insertRows(
  q: Queryable,
  table: string,
  userId: string,
  rows: Record<string, unknown>[]
) {
  const columns = INSERT_COLUMNS[table];
  for (const row of rows) {
    const values = pick(row, columns);
    const cols = Object.keys(values);
    const placeholders = cols.map((_, i) => `$${i + 2}`);
    await q.query(
      `INSERT INTO ${table} (user_id, ${cols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})`,
      [userId, ...cols.map((c) => values[c])]
    );
  }
}

/**
 * Restores a backup for one user only. Everything runs inside a single
 * transaction: a partial restore can never leave inconsistent balances.
 */
export async function restoreUserBackup(q: Queryable, userId: string, payload: BackupPayload) {
  const accounts = asArray(payload.accounts, 'accounts');
  const categories = asArray(payload.categories, 'categories');
  const transactions = asArray(payload.transactions, 'transactions');
  const loans = asArray(payload.loans, 'loans');
  const loanPayments = asArray(payload.loanPayments, 'loanPayments');
  const fxRates = asArray(payload.fxRates, 'fxRates');

  await q.query(`DELETE FROM loan_payments WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM loans WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM accounts WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM categories WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM fx_rates WHERE user_id = $1`, [userId]);

  await insertRows(q, 'categories', userId, categories);
  await insertRows(q, 'accounts', userId, accounts);
  for (const fx of fxRates) {
    if (!fx.currency || fx.rate === undefined) continue;
    await q.query(
      `INSERT INTO fx_rates (user_id, currency, rate, as_of) VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE))
       ON CONFLICT (user_id, currency, as_of) DO UPDATE SET rate = EXCLUDED.rate`,
      [userId, fx.currency, String(fx.rate), fx.as_of ?? null]
    );
  }
  await insertRows(q, 'transactions', userId, transactions);
  await insertRows(q, 'loans', userId, loans);
  await insertRows(q, 'loan_payments', userId, loanPayments);

  const count = await q.query<{ accounts: string; transactions: string; loans: string }>(
    `SELECT (SELECT COUNT(*) FROM accounts WHERE user_id = $1) AS accounts,
            (SELECT COUNT(*) FROM transactions WHERE user_id = $1) AS transactions,
            (SELECT COUNT(*) FROM loans WHERE user_id = $1) AS loans`,
    [userId]
  );
  return {
    accounts: Number(count.rows[0]?.accounts ?? 0),
    transactions: Number(count.rows[0]?.transactions ?? 0),
    loans: Number(count.rows[0]?.loans ?? 0)
  };
}

export function backupSizeKb(payload: BackupPayload): string {
  return dec(JSON.stringify(payload).length).div(1024).toDecimalPlaces(1).toFixed(1);
}
