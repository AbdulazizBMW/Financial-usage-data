import { Router } from 'express';
import { getAuth, logAudit } from '../auth.js';
import {
  ACCOUNT_TYPES,
  PAYMENT_METHODS,
  addDays,
  dec,
  isCurrency,
  isValidDate,
  money,
  monthBounds,
  parseMonth,
  percent,
  rate as rateStr,
  resolveRange,
  todayISO,
  type DateRange
} from '../money.js';
import {
  accountBalances,
  buildDashboard,
  categoryTotals,
  currencyFlows,
  dailySeries,
  getUserBase,
  listTransactions,
  loadRates,
  loanTotals,
  monthlyTrend,
  periodFlows,
  rateOf,
  sumBase
} from '../finance.js';
import {
  asyncHandler,
  amount,
  badRequest,
  body,
  date,
  HttpError,
  notFound,
  oneOf,
  optionalDate,
  optionalUuid,
  positiveAmount,
  positiveRate,
  str,
  uuid
} from '../http.js';
import type { Queryable } from '../db.js';

export const coreRouter = Router();

interface AccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  opening_balance: string;
  opening_date: string;
  archived: boolean;
}

async function accountRow(q: Queryable, userId: string, id: string): Promise<AccountRow> {
  const { rows } = await q.query<AccountRow>(
    `SELECT id, name, type, currency, opening_balance, to_char(opening_date, 'YYYY-MM-DD') AS opening_date, archived
       FROM accounts WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rows[0]) throw notFound('Account not found.');
  return rows[0];
}

function pickCurrency(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (!isCurrency(value)) throw badRequest('Currency must be UZS or USD.');
  return value;
}

interface CashAmounts {
  accountAmount: string;
  baseAmount: string;
  fxRate: string;
}

/**
 * Converts a user-entered amount into the account currency and the reporting
 * base currency using exact decimal arithmetic.
 */
function cashAmounts(
  rawAmount: string,
  currency: string,
  accountCurrency: string,
  baseRate: ReturnType<typeof dec>,
  rateToAccount?: string | null
): CashAmounts {
  const amountDec = dec(rawAmount);
  let accountAmount = amountDec;
  if (currency !== accountCurrency) {
    const r = rateToAccount ? dec(rateToAccount) : null;
    if (!r || r.lte(0)) {
      throw badRequest(
        `This account is held in ${accountCurrency}. Provide the ${currency}→${accountCurrency} exchange rate for this record.`
      );
    }
    accountAmount = amountDec.times(r);
  }
  return {
    accountAmount: money(accountAmount),
    baseAmount: money(amountDec.times(baseRate)),
    fxRate: rateStr(baseRate)
  };
}

async function validateCategory(q: Queryable, userId: string, id: string | null, kind: string) {
  if (!id) return null;
  const { rows } = await q.query<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND user_id = $2`, [
    id,
    userId
  ]);
  if (!rows[0]) throw badRequest('Category not found.');
  if (rows[0].kind !== kind) throw badRequest(`Pick a ${kind} category.`);
  return id;
}

/* ------------------------------------------------------------------ dashboard */

coreRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const range = resolveRange(req.query.preset, req.query.from, req.query.to);
    const base = await getUserBase(db, user.id);
    const data = await buildDashboard(db, user.id, range, base);
    res.json(data);
  })
);

/* --------------------------------------------------------------- transactions */

coreRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const range = resolveRange(req.query.preset, req.query.from, req.query.to);
    const filters = {
      from: range.from,
      to: range.to,
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
      categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
      accountId: typeof req.query.accountId === 'string' ? req.query.accountId : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : 'date_desc',
      limit: Number(req.query.limit) || 300
    };
    const transactions = await listTransactions(db, user.id, filters);
    const flows = await periodFlows(db, user.id, range);
    const daily = await dailySeries(db, user.id, range);
    const byCurrency = await currencyFlows(db, user.id, range);
    res.json({
      range,
      transactions,
      summary: {
        income: flows.income,
        expenses: flows.expenses,
        netCashFlow: flows.netCashFlow,
        incomeCount: flows.incomeCount,
        expenseCount: flows.expenseCount,
        transferCount: flows.transferCount
      },
      daily,
      byCurrency
    });
  })
);

coreRouter.post(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const kind = oneOf(payload.kind, ['income', 'expense'] as const, 'Transaction type');
    const txnDate = date(payload.date, 'Date');
    const rawAmount = positiveAmount(payload.amount, 'Amount');
    const accountId = uuid(payload.accountId, 'Account');
    const paymentMethod = oneOf(payload.paymentMethod ?? 'cash', PAYMENT_METHODS, 'Payment method');
    const description = str(payload.description, 'Description', { max: 300, optional: true });
    const categoryId = await validateCategory(db, user.id, optionalUuid(payload.categoryId, 'Category'), kind);

    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const account = await accountRow(db, user.id, accountId);
    const currency = pickCurrency(payload.currency, account.currency);
    const converted = cashAmounts(
      rawAmount,
      currency,
      account.currency,
      rateOf(rates, currency),
      payload.rateToAccount ? positiveRate(payload.rateToAccount, 'Exchange rate') : null
    );

    const created = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO transactions
           (user_id, kind, txn_date, amount, currency, fx_rate, account_id, account_amount, base_amount,
            category_id, description, payment_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          user.id,
          kind,
          txnDate,
          rawAmount,
          currency,
          converted.fxRate,
          accountId,
          converted.accountAmount,
          converted.baseAmount,
          categoryId,
          description,
          paymentMethod
        ]
      );
      await logAudit(q, user.id, 'transaction', rows[0].id, 'created', {
        kind,
        amount: rawAmount,
        currency,
        accountId
      });
      return rows[0];
    });
    const [txn] = await listTransactions(db, user.id, { from: '1900-01-01', to: '2999-12-31', limit: 2000 }).then(
      (rows) => rows.filter((r) => r.id === created.id)
    );
    res.status(201).json({ transaction: txn, id: created.id });
  })
);

coreRouter.patch(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Transaction');
    const payload = body<Record<string, unknown>>(req);
    const { rows: existingRows } = await db.query<{
      id: string;
      kind: string;
      account_id: string;
      currency: string;
    }>(`SELECT id, kind, account_id, currency FROM transactions WHERE id = $1 AND user_id = $2`, [id, user.id]);
    const existing = existingRows[0];
    if (!existing) throw notFound('Transaction not found.');
    if (existing.kind === 'transfer') throw badRequest('Edit transfers from the Accounts page.');

    const kind = payload.kind ? oneOf(payload.kind, ['income', 'expense'] as const, 'Transaction type') : existing.kind;
    const txnDate = payload.date ? date(payload.date, 'Date') : null;
    const rawAmount = payload.amount ? positiveAmount(payload.amount, 'Amount') : null;
    const accountId = payload.accountId ? uuid(payload.accountId, 'Account') : existing.account_id;
    const paymentMethod = payload.paymentMethod
      ? oneOf(payload.paymentMethod, PAYMENT_METHODS, 'Payment method')
      : null;
    const categoryId =
      payload.categoryId === undefined
        ? undefined
        : await validateCategory(db, user.id, optionalUuid(payload.categoryId, 'Category'), kind);

    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const account = await accountRow(db, user.id, accountId);
    const currency = pickCurrency(payload.currency, existing.currency || account.currency);

    const { rows: currentRows } = await db.query<{ amount: string }>(
      `SELECT amount FROM transactions WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );
    const effectiveAmount = rawAmount ?? money(currentRows[0].amount);
    const converted = cashAmounts(
      effectiveAmount,
      currency,
      account.currency,
      rateOf(rates, currency),
      payload.rateToAccount ? positiveRate(payload.rateToAccount, 'Exchange rate') : null
    );

    await db.tx(async (q) => {
      await q.query(
        `UPDATE transactions SET
           kind = $3,
           txn_date = COALESCE($4, txn_date),
           amount = $5,
           currency = $6,
           fx_rate = $7,
           account_id = $8,
           account_amount = $9,
           base_amount = $10,
           category_id = $11,
           description = COALESCE($12, description),
           payment_method = COALESCE($13, payment_method),
           updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [
          id,
          user.id,
          kind,
          txnDate,
          effectiveAmount,
          currency,
          converted.fxRate,
          accountId,
          converted.accountAmount,
          converted.baseAmount,
          categoryId === undefined ? null : categoryId,
          payload.description === undefined ? null : str(payload.description, 'Description', { max: 300, optional: true }),
          paymentMethod
        ]
      );
      await logAudit(q, user.id, 'transaction', id, 'updated', { kind, amount: effectiveAmount, currency });
    });
    res.json({ ok: true });
  })
);

coreRouter.delete(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Transaction');
    const deleted = await db.tx(async (q) => {
      const { rows } = await q.query<{ kind: string; amount: string; currency: string }>(
        `DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING kind, amount, currency`,
        [id, user.id]
      );
      if (!rows[0]) throw notFound('Transaction not found.');
      await logAudit(q, user.id, 'transaction', id, 'deleted', rows[0]);
      return rows[0];
    });
    res.json({ ok: true, deleted });
  })
);

/* ------------------------------------------------------------------ transfers */

coreRouter.post(
  '/transfers',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const txnDate = date(payload.date, 'Date');
    const fromId = uuid(payload.fromAccountId, 'Source account');
    const toId = uuid(payload.toAccountId, 'Destination account');
    if (fromId === toId) throw badRequest('Choose two different accounts for a transfer.');
    const rawAmount = positiveAmount(payload.amount, 'Amount');
    const description = str(payload.description, 'Description', { max: 300, optional: true });

    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const from = await accountRow(db, user.id, fromId);
    const to = await accountRow(db, user.id, toId);

    const fromAmount = dec(rawAmount);
    const toAmount = payload.toAmount
      ? dec(positiveAmount(payload.toAmount, 'Received amount'))
      : from.currency === to.currency
        ? fromAmount
        : fromAmount.times(rateOf(rates, from.currency)).div(rateOf(rates, to.currency));

    const fromBase = fromAmount.times(rateOf(rates, from.currency));
    const toBase = toAmount.times(rateOf(rates, to.currency));

    const created = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO transactions
           (user_id, kind, txn_date, amount, currency, fx_rate, account_id, account_amount, base_amount,
            counter_account_id, counter_amount, counter_base_amount, description, payment_method)
         VALUES ($1,'transfer',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'bank_transfer') RETURNING id`,
        [
          user.id,
          txnDate,
          money(fromAmount),
          from.currency,
          rateStr(rateOf(rates, from.currency)),
          fromId,
          money(fromAmount),
          money(fromBase),
          toId,
          money(toAmount),
          money(toBase),
          description || `${from.name} → ${to.name}`
        ]
      );
      await logAudit(q, user.id, 'transfer', rows[0].id, 'created', {
        from: from.name,
        to: to.name,
        amount: money(fromAmount),
        currency: from.currency
      });
      return rows[0];
    });
    res.status(201).json({ ok: true, id: created.id });
  })
);

/* ------------------------------------------------------------------- accounts */

coreRouter.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const accounts = await accountBalances(db, user.id, rates, todayISO());
    res.json({ accounts, totalBase: sumBase(accounts), baseCurrency: base, rates });
  })
);

coreRouter.post(
  '/accounts',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const name = str(payload.name, 'Account name', { max: 80 });
    const type = oneOf(payload.type ?? 'cash', ACCOUNT_TYPES, 'Account type');
    const currency = pickCurrency(payload.currency, await getUserBase(db, user.id));
    const openingBalance = payload.openingBalance === undefined ? '0.00' : amount(payload.openingBalance, 'Opening balance');
    const openingDate = payload.openingDate ? date(payload.openingDate, 'Opening date') : todayISO();

    const created = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO accounts (user_id, name, type, currency, opening_balance, opening_date)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [user.id, name, type, currency, openingBalance, openingDate]
      );
      await logAudit(q, user.id, 'account', rows[0].id, 'created', { name, type, currency, openingBalance });
      return rows[0];
    });
    res.status(201).json({ id: created.id });
  })
);

coreRouter.patch(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Account');
    const payload = body<Record<string, unknown>>(req);
    const account = await accountRow(db, user.id, id);

    const name = payload.name === undefined ? account.name : str(payload.name, 'Account name', { max: 80 });
    const type = payload.type === undefined ? account.type : oneOf(payload.type, ACCOUNT_TYPES, 'Account type');
    const currency = pickCurrency(payload.currency, account.currency);
    if (currency !== account.currency) {
      const usage = await db.query<{ n: string }>(
        `SELECT (SELECT COUNT(*) FROM transactions WHERE account_id = $1 OR counter_account_id = $1)
              + (SELECT COUNT(*) FROM loans WHERE account_id = $1)
              + (SELECT COUNT(*) FROM loan_payments WHERE account_id = $1) AS n`,
        [id]
      );
      if (Number(usage.rows[0]?.n ?? 0) > 0) {
        throw badRequest('This account already has records in another currency. Create a new account instead.');
      }
    }
    const openingBalance =
      payload.openingBalance === undefined ? account.opening_balance : amount(payload.openingBalance, 'Opening balance');
    const openingDate = payload.openingDate ? date(payload.openingDate, 'Opening date') : account.opening_date;
    const archived = payload.archived === undefined ? account.archived : Boolean(payload.archived);

    await db.tx(async (q) => {
      await q.query(
        `UPDATE accounts SET name = $3, type = $4, currency = $5, opening_balance = $6, opening_date = $7,
                archived = $8, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [id, user.id, name, type, currency, openingBalance, openingDate, archived]
      );
      await logAudit(q, user.id, 'account', id, 'updated', { name, currency, openingBalance, archived });
    });
    res.json({ ok: true });
  })
);

coreRouter.delete(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Account');
    await accountRow(db, user.id, id);
    const usage = await db.query<{ n: string }>(
      `SELECT (SELECT COUNT(*) FROM transactions WHERE account_id = $1 OR counter_account_id = $1)
            + (SELECT COUNT(*) FROM loans WHERE account_id = $1)
            + (SELECT COUNT(*) FROM loan_payments WHERE account_id = $1) AS n`,
      [id]
    );
    if (Number(usage.rows[0]?.n ?? 0) > 0) {
      throw badRequest('This account has records linked to it. Archive it instead of deleting so history stays intact.');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM accounts WHERE id = $1 AND user_id = $2`, [id, user.id]);
      await logAudit(q, user.id, 'account', id, 'deleted', {});
    });
    res.json({ ok: true });
  })
);

coreRouter.get(
  '/accounts/:id/movements',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Account');
    const account = await accountRow(db, user.id, id);
    const { rows } = await db.query<{
      d: string;
      source: string;
      label: string;
      description: string;
      delta: string;
      base_delta: string;
      ref_id: string;
    }>(
      `SELECT to_char(t.txn_date, 'YYYY-MM-DD') AS d, t.kind AS source,
              COALESCE(c.name, CASE WHEN t.kind = 'transfer' THEN 'Transfer out' ELSE 'Uncategorised' END) AS label,
              t.description,
              t.account_amount AS delta, t.base_amount AS base_delta, t.id AS ref_id
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = $1 AND t.account_id = $2
       UNION ALL
       SELECT to_char(t.txn_date, 'YYYY-MM-DD'), 'transfer_in', 'Transfer in', t.description,
              COALESCE(t.counter_amount, 0), COALESCE(t.counter_base_amount, 0), t.id
         FROM transactions t
        WHERE t.user_id = $1 AND t.kind = 'transfer' AND t.counter_account_id = $2
       UNION ALL
       SELECT to_char(l.loan_date, 'YYYY-MM-DD'),
              CASE l.direction WHEN 'lend' THEN 'lending' ELSE 'borrowing' END,
              CASE l.direction WHEN 'lend' THEN 'Money lent to ' ELSE 'Money borrowed from ' END || l.counterparty,
              l.description,
              CASE l.direction WHEN 'lend' THEN -l.account_amount ELSE l.account_amount END,
              CASE l.direction WHEN 'lend' THEN -l.base_amount ELSE l.base_amount END,
              l.id
         FROM loans l WHERE l.user_id = $1 AND l.account_id = $2
       UNION ALL
       SELECT to_char(p.pay_date, 'YYYY-MM-DD'),
              CASE l.direction WHEN 'lend' THEN 'repayment_in' ELSE 'repayment_out' END,
              CASE l.direction WHEN 'lend' THEN 'Repayment received from ' ELSE 'Repayment sent to ' END || l.counterparty,
              p.note,
              CASE l.direction WHEN 'lend' THEN p.account_amount ELSE -p.account_amount END,
              CASE l.direction WHEN 'lend' THEN p.base_amount ELSE -p.base_amount END,
              p.id
         FROM loan_payments p JOIN loans l ON l.id = p.loan_id
        WHERE p.user_id = $1 AND p.account_id = $2
       ORDER BY d ASC`,
      [user.id, id]
    );
    let running = dec(account.opening_balance);
    const movements = rows.map((row) => {
      running = running.plus(dec(row.delta));
      return { ...row, delta: money(row.delta), base_delta: money(row.base_delta), balance: money(running) };
    });
    res.json({
      account: { ...account, openingBalance: account.opening_balance, balance: money(running) },
      movements
    });
  })
);

/* ----------------------------------------------------------------- categories */

coreRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const { rows } = await db.query<{ id: string; name: string; kind: string; usage_count: string }>(
      `SELECT c.id, c.name, c.kind,
              (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage_count
         FROM categories c WHERE c.user_id = $1
        ORDER BY c.kind, lower(c.name)`,
      [user.id]
    );
    res.json({
      categories: rows.map((r) => ({ ...r, usageCount: Number(r.usage_count) }))
    });
  })
);

coreRouter.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const name = str(payload.name, 'Category name', { max: 60 });
    const kind = oneOf(payload.kind, ['income', 'expense'] as const, 'Category type');
    const existing = await db.query(`SELECT 1 FROM categories WHERE user_id = $1 AND kind = $2 AND lower(name) = lower($3)`, [
      user.id,
      kind,
      name
    ]);
    if (existing.rows.length) throw badRequest('That category already exists.');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO categories (user_id, name, kind) VALUES ($1,$2,$3) RETURNING id`,
      [user.id, name, kind]
    );
    await logAudit(db, user.id, 'category', rows[0].id, 'created', { name, kind });
    res.status(201).json({ id: rows[0].id });
  })
);

coreRouter.patch(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Category');
    const payload = body<Record<string, unknown>>(req);
    const name = str(payload.name, 'Category name', { max: 60 });
    const { rows } = await db.query<{ id: string }>(
      `UPDATE categories SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, user.id, name]
    );
    if (!rows[0]) throw notFound('Category not found.');
    await logAudit(db, user.id, 'category', id, 'updated', { name });
    res.json({ ok: true });
  })
);

coreRouter.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Category');
    const deleted = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string; name: string }>(
        `DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id, name`,
        [id, user.id]
      );
      if (!rows[0]) throw notFound('Category not found.');
      await logAudit(q, user.id, 'category', id, 'deleted', { name: rows[0].name });
      return rows[0];
    });
    res.json({ ok: true, deleted });
  })
);

/* ------------------------------------------------------------- exchange rates */

coreRouter.get(
  '/fx-rates',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const { rows } = await db.query<{ currency: string; rate: string; as_of: string }>(
      `SELECT currency, rate, to_char(as_of, 'YYYY-MM-DD') AS as_of FROM fx_rates
        WHERE user_id = $1 ORDER BY as_of DESC, currency`,
      [user.id]
    );
    res.json({ baseCurrency: base, latest: rates, history: rows });
  })
);

coreRouter.post(
  '/fx-rates',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const currency = pickCurrency(payload.currency, 'USD');
    const value = positiveRate(payload.rate, 'Exchange rate');
    const asOf = payload.asOf ? date(payload.asOf, 'Effective date') : todayISO();
    const base = await getUserBase(db, user.id);
    if (currency === base) throw badRequest('The base currency always has a rate of 1.');
    await db.query(
      `INSERT INTO fx_rates (user_id, currency, rate, as_of) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, currency, as_of) DO UPDATE SET rate = EXCLUDED.rate`,
      [user.id, currency, value, asOf]
    );
    await logAudit(db, user.id, 'fx_rate', null, 'set', { currency, rate: value, asOf, base });
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------- settings */

async function recomputeBaseAmounts(q: Queryable, userId: string, base: string) {
  const rateExpr = (currencyCol: string, dateCol: string) => `COALESCE(
      (SELECT f.rate FROM fx_rates f
        WHERE f.user_id = $1 AND f.currency = ${currencyCol} AND f.as_of <= ${dateCol}
        ORDER BY f.as_of DESC LIMIT 1),
      (SELECT f.rate FROM fx_rates f
        WHERE f.user_id = $1 AND f.currency = ${currencyCol}
        ORDER BY f.as_of DESC LIMIT 1),
      CASE WHEN ${currencyCol} = $2 THEN 1 ELSE 1 END)`;

  await q.query(
    `UPDATE transactions SET base_amount = ROUND(amount * ${rateExpr('currency', 'txn_date')}, 2)
      WHERE user_id = $1 AND currency <> $2`,
    [userId, base]
  );
  await q.query(`UPDATE transactions SET base_amount = amount WHERE user_id = $1 AND currency = $2`, [userId, base]);
  await q.query(
    `UPDATE transactions SET counter_base_amount = ROUND(counter_amount * ${rateExpr('currency', 'txn_date')}, 2)
      WHERE user_id = $1 AND kind = 'transfer' AND counter_account_id IS NOT NULL`,
    [userId, base]
  );
  await q.query(
    `UPDATE loans SET base_amount = ROUND(amount * ${rateExpr('currency', 'loan_date')}, 2)
      WHERE user_id = $1 AND currency <> $2`,
    [userId, base]
  );
  await q.query(`UPDATE loans SET base_amount = amount WHERE user_id = $1 AND currency = $2`, [userId, base]);
  await q.query(
    `UPDATE loan_payments SET base_amount = ROUND(amount * ${rateExpr('currency', 'pay_date')}, 2)
      WHERE user_id = $1 AND currency <> $2`,
    [userId, base]
  );
  await q.query(`UPDATE loan_payments SET base_amount = amount WHERE user_id = $1 AND currency = $2`, [userId, base]);
}

coreRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const name = payload.name === undefined ? user.name : str(payload.name, 'Full name', { min: 2, max: 80 });
    const theme = payload.theme === undefined ? user.theme : oneOf(payload.theme, ['light', 'dark'] as const, 'Theme');
    const baseCurrency = payload.baseCurrency === undefined ? user.base_currency : pickCurrency(payload.baseCurrency, user.base_currency);

    await db.tx(async (q) => {
      await q.query(`UPDATE users SET name = $2, theme = $3, base_currency = $4, updated_at = now() WHERE id = $1`, [
        user.id,
        name,
        theme,
        baseCurrency
      ]);
      if (baseCurrency !== user.base_currency) {
        await recomputeBaseAmounts(q, user.id, baseCurrency);
        await q.query(
          `INSERT INTO fx_rates (user_id, currency, rate, as_of) VALUES ($1,$2,$3,CURRENT_DATE)
           ON CONFLICT (user_id, currency, as_of) DO NOTHING`,
          [user.id, user.base_currency, baseCurrency === 'USD' ? 12800 : 1 / 12800]
        );
        await logAudit(q, user.id, 'user', user.id, 'base_currency_changed', {
          from: user.base_currency,
          to: baseCurrency
        });
      }
    });
    const { rows } = await db.query(`SELECT id, email, name, base_currency, theme, created_at FROM users WHERE id = $1`, [
      user.id
    ]);
    res.json({ user: rows[0] });
  })
);

coreRouter.post(
  '/settings/password',
  asyncHandler(async (req, res) => {
    const { db, user, token } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const current = str(payload.currentPassword, 'Current password', { max: 200, trim: false });
    const next = str(payload.newPassword, 'New password', { max: 200, trim: false });
    if (next.length < 8) throw badRequest('New password must be at least 8 characters.');
    const { verifyPassword, hashPassword, sha256 } = await import('../auth.js');
    const { rows } = await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [
      user.id
    ]);
    if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
      throw badRequest('Your current password is incorrect.');
    }
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
        user.id,
        await hashPassword(next)
      ]);
      await q.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, sha256(token)]);
      await logAudit(q, user.id, 'user', user.id, 'password_changed', {});
    });
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ analytics */

coreRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const range = resolveRange(req.query.preset, req.query.from, req.query.to);
    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const flows = await periodFlows(db, user.id, range);
    const loans = await loanTotals(db, user.id, range);
    const daily = await dailySeries(db, user.id, range);
    const expenseByCategory = await categoryTotals(db, user.id, range, 'expense');
    const incomeByCategory = await categoryTotals(db, user.id, range, 'income');
    const trend = await monthlyTrend(db, user.id, 12, base);
    const byCurrency = await currencyFlows(db, user.id, range);
    const accounts = await accountBalances(db, user.id, rates, todayISO());

    const yearly = await db.query<{ year: string; income: string; expense: string }>(
      `SELECT to_char(txn_date, 'YYYY') AS year,
              COALESCE(SUM(base_amount) FILTER (WHERE kind = 'income'), 0) AS income,
              COALESCE(SUM(base_amount) FILTER (WHERE kind = 'expense'), 0) AS expense
         FROM transactions WHERE user_id = $1 AND kind <> 'transfer'
        GROUP BY 1 ORDER BY 1`,
      [user.id]
    );

    const monthEnds: { month: string; label: string; total: string; accounts: { name: string; balance: string }[] }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
      const asOf = d.toISOString().slice(0, 10);
      const balances = await accountBalances(db, user.id, rates, asOf);
      monthEnds.push({
        month: asOf.slice(0, 7),
        label: asOf.slice(0, 7),
        total: sumBase(balances),
        accounts: balances.map((a) => ({ name: a.name, balance: a.baseBalance }))
      });
    }

    const month = monthBounds(Number(todayISO().slice(0, 4)), Number(todayISO().slice(5, 7)));
    const monthFlows = await periodFlows(db, user.id, month);
    const lastMonthDate = new Date(Date.UTC(Number(month.from.slice(0, 4)), Number(month.from.slice(5, 7)) - 2, 1));
    const lastMonth = monthBounds(lastMonthDate.getUTCFullYear(), lastMonthDate.getUTCMonth() + 1);
    const lastMonthFlows = await periodFlows(db, user.id, lastMonth);

    const topExpense = expenseByCategory[0];
    const savings = dec(flows.income).minus(dec(flows.expenses));
    const monthExpenseChange = dec(monthFlows.expenses).minus(dec(lastMonthFlows.expenses));
    const negativeMonths = trend.filter((t) => dec(t.net).lt(0)).map((t) => t.label);
    const positiveMonths = trend.filter((t) => dec(t.net).gt(0)).map((t) => t.label);

    const insights = [
      topExpense
        ? `${topExpense.name} is your largest expense category in this period, at ${money(topExpense.total)} ${base} (${percent(
            topExpense.total,
            flows.expenses
          )}% of spending).`
        : 'No expenses recorded in this period yet.',
      `You spent ${money(monthFlows.expenses)} ${base} this month, ${
        monthExpenseChange.gte(0) ? 'up' : 'down'
      } ${money(monthExpenseChange.abs())} ${base} compared with last month.`,
      `You saved ${money(savings)} ${base} in this period, a savings rate of ${percent(savings, flows.income)}%.`,
      `Outstanding debt: ${money(loans.receivables)} ${base} receivable from others and ${money(
        loans.payables
      )} ${base} payable by you.`,
      positiveMonths.length
        ? `Positive cash-flow months in the last year: ${positiveMonths.join(', ')}.`
        : 'No positive cash-flow months recorded in the last year.',
      negativeMonths.length ? `Negative cash-flow months: ${negativeMonths.join(', ')}.` : 'Every recent month had a positive cash flow.'
    ];

    res.json({
      range,
      baseCurrency: base,
      income: flows.income,
      expenses: flows.expenses,
      netCashFlow: flows.netCashFlow,
      savings: money(savings),
      savingsRate: percent(savings, flows.income),
      receivables: loans.receivables,
      payables: loans.payables,
      totalLent: loans.totalLent,
      totalBorrowed: loans.totalBorrowed,
      daily,
      trend,
      yearly: yearly.rows.map((r) => ({
        year: r.year,
        income: money(r.income),
        expense: money(r.expense),
        net: money(dec(r.income).minus(dec(r.expense)))
      })),
      expenseByCategory,
      incomeByCategory,
      byCurrency,
      accounts,
      accountHistory: monthEnds,
      insights,
      warnings: rates.missing.length
        ? [`Set an exchange rate for ${rates.missing.join(', ')} so consolidated figures are exact.`]
        : []
    });
  })
);

/* ---------------------------------------------------------------------- audit */

coreRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const { rows } = await db.query(
      `SELECT id, entity, entity_id, action, detail, created_at FROM audit_log
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`,
      [user.id]
    );
    res.json({ entries: rows });
  })
);

/* ------------------------------------------------------------------ metadata */

coreRouter.get(
  '/meta',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const durable = db.durable;
    res.json({
      baseCurrency: base,
      currencies: ['UZS', 'USD'],
      accountTypes: ACCOUNT_TYPES,
      paymentMethods: PAYMENT_METHODS,
      rates,
      storage: {
        engine: db.kind === 'postgres' ? 'PostgreSQL' : 'Embedded PostgreSQL (PGlite)',
        durable,
        message: durable
          ? 'Records are stored in your persistent PostgreSQL database.'
          : 'DATABASE_URL is not configured. Records live in the container filesystem and will not survive a redeploy.'
      },
      mailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
      today: todayISO(),
      isValidDateSample: isValidDate(todayISO()),
      presets: ['today', 'yesterday', 'last7', 'this_month', 'last_month', 'this_year', 'custom', 'all']
    });
  })
);

export function monthFromQuery(value: unknown): { year: number; month: number } {
  return parseMonth(value);
}

export function rangeFromQuery(value: unknown): DateRange {
  return resolveRange(value);
}

export const __testables = { cashAmounts, addDays };
export { HttpError };
