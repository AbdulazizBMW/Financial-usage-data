import { Router } from 'express';
import { getAuth, logAudit } from '../auth.js';
import { dec, money, rate as rateStr, todayISO } from '../money.js';
import { getLoan, listLoans, loadRates, loanTotals, getUserBase, rateOf } from '../finance.js';
import { accountRow, cashAmounts, pickCurrency } from '../cash.js';
import {
  asyncHandler,
  body,
  date,
  notFound,
  oneOf,
  positiveAmount,
  positiveRate,
  str,
  uuid
} from '../http.js';
import { resolveRange } from '../money.js';

export const loansRouter = Router();

loansRouter.get(
  '/loans',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const direction = oneOf(req.query.direction ?? 'lend', ['lend', 'borrow'] as const, 'Direction');
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const loans = await listLoans(db, user.id, direction, { status, search });
    const base = await getUserBase(db, user.id);
    const range = resolveRange(req.query.preset, req.query.from, req.query.to);
    const totals = await loanTotals(db, user.id, range);
    res.json({ direction, loans, totals, baseCurrency: base, range });
  })
);

loansRouter.get(
  '/loans/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const loan = await getLoan(db, user.id, uuid(req.params.id, 'Loan'));
    if (!loan) throw notFound('Loan not found.');
    res.json({ loan });
  })
);

loansRouter.post(
  '/loans',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const payload = body<Record<string, unknown>>(req);
    const direction = oneOf(payload.direction, ['lend', 'borrow'] as const, 'Direction');
    const counterparty = str(payload.counterparty, direction === 'lend' ? "Borrower's name" : "Lender's name", {
      max: 120
    });
    const rawAmount = positiveAmount(payload.amount, 'Amount');
    const accountId = uuid(payload.accountId, 'Account');
    const loanDate = date(payload.date, 'Date');
    const dueDate = payload.dueDate ? date(payload.dueDate, 'Expected repayment date') : null;
    const description = str(payload.description, 'Description', { max: 300, optional: true });
    const notes = str(payload.notes, 'Notes', { max: 2000, optional: true });

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
        `INSERT INTO loans
           (user_id, direction, counterparty, amount, currency, fx_rate, account_amount, base_amount,
            account_id, loan_date, due_date, description, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          user.id,
          direction,
          counterparty,
          rawAmount,
          currency,
          converted.fxRate,
          converted.accountAmount,
          converted.baseAmount,
          accountId,
          loanDate,
          dueDate,
          description,
          notes
        ]
      );
      await logAudit(q, user.id, 'loan', rows[0].id, 'created', { direction, counterparty, amount: rawAmount, currency });
      return rows[0];
    });
    res.status(201).json({ id: created.id });
  })
);

loansRouter.patch(
  '/loans/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Loan');
    const payload = body<Record<string, unknown>>(req);
    const { rows: existingRows } = await db.query<{
      direction: string;
      counterparty: string;
      amount: string;
      currency: string;
      account_id: string;
      loan_date: string;
      due_date: string | null;
    }>(
      `SELECT direction, counterparty, amount, currency, account_id,
              to_char(loan_date, 'YYYY-MM-DD') AS loan_date, to_char(due_date, 'YYYY-MM-DD') AS due_date
         FROM loans WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );
    const existing = existingRows[0];
    if (!existing) throw notFound('Loan not found.');

    const counterparty =
      payload.counterparty === undefined ? existing.counterparty : str(payload.counterparty, 'Name', { max: 120 });
    const rawAmount = payload.amount === undefined ? money(existing.amount) : positiveAmount(payload.amount, 'Amount');
    const accountId = payload.accountId ? uuid(payload.accountId, 'Account') : existing.account_id;
    const loanDate = payload.date ? date(payload.date, 'Date') : existing.loan_date;
    const dueDate = payload.dueDate === undefined ? existing.due_date : payload.dueDate === null || payload.dueDate === '' ? null : date(payload.dueDate, 'Expected repayment date');
    const description =
      payload.description === undefined
        ? undefined
        : str(payload.description, 'Description', { max: 300, optional: true });
    const notes = payload.notes === undefined ? undefined : str(payload.notes, 'Notes', { max: 2000, optional: true });

    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const account = await accountRow(db, user.id, accountId);
    const currency = pickCurrency(payload.currency, existing.currency);
    const converted = cashAmounts(
      rawAmount,
      currency,
      account.currency,
      rateOf(rates, currency),
      payload.rateToAccount ? positiveRate(payload.rateToAccount, 'Exchange rate') : null
    );

    const paid = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM loan_payments WHERE loan_id = $1 AND user_id = $2`,
      [id, user.id]
    );
    if (dec(rawAmount).lt(dec(paid.rows[0]?.total ?? 0))) {
      throw notFound(`The amount cannot be lower than the ${money(paid.rows[0]?.total ?? 0)} already repaid.`);
    }

    await db.tx(async (q) => {
      await q.query(
        `UPDATE loans SET counterparty = $3, amount = $4, currency = $5, fx_rate = $6, account_amount = $7,
                base_amount = $8, account_id = $9, loan_date = $10, due_date = $11,
                description = COALESCE($12, description), notes = COALESCE($13, notes), updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          id,
          user.id,
          counterparty,
          rawAmount,
          currency,
          converted.fxRate,
          converted.accountAmount,
          converted.baseAmount,
          accountId,
          loanDate,
          dueDate,
          description,
          notes
        ]
      );
      await logAudit(q, user.id, 'loan', id, 'updated', { amount: rawAmount, currency });
    });
    res.json({ ok: true });
  })
);

loansRouter.delete(
  '/loans/:id',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Loan');
    await db.tx(async (q) => {
      const { rows } = await q.query<{ counterparty: string; amount: string; currency: string }>(
        `DELETE FROM loans WHERE id = $1 AND user_id = $2 RETURNING counterparty, amount, currency`,
        [id, user.id]
      );
      if (!rows[0]) throw notFound('Loan not found.');
      await logAudit(q, user.id, 'loan', id, 'deleted', rows[0]);
    });
    res.json({ ok: true });
  })
);

loansRouter.post(
  '/loans/:id/payments',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Loan');
    const payload = body<Record<string, unknown>>(req);
    const payDate = date(payload.date, 'Repayment date');
    const rawAmount = positiveAmount(payload.amount, 'Repayment amount');
    const accountId = uuid(payload.accountId, 'Account');
    const note = str(payload.note, 'Note', { max: 500, optional: true });

    const { rows: loanRows } = await db.query<{
      direction: string;
      amount: string;
      currency: string;
      counterparty: string;
    }>(`SELECT direction, amount, currency, counterparty FROM loans WHERE id = $1 AND user_id = $2`, [id, user.id]);
    const loan = loanRows[0];
    if (!loan) throw notFound('Loan not found.');

    const { rows: paidRows } = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM loan_payments WHERE loan_id = $1 AND user_id = $2`,
      [id, user.id]
    );
    const outstanding = dec(loan.amount).minus(dec(paidRows[0]?.total ?? 0));
    if (dec(rawAmount).gt(outstanding)) {
      throw new Error(
        `The repayment is larger than the outstanding balance of ${money(outstanding)} ${loan.currency}.`
      );
    }

    const base = await getUserBase(db, user.id);
    const rates = await loadRates(db, user.id, base);
    const account = await accountRow(db, user.id, accountId);
    const currency = pickCurrency(payload.currency, loan.currency);
    const converted = cashAmounts(
      rawAmount,
      currency,
      account.currency,
      rateOf(rates, currency),
      payload.rateToAccount ? positiveRate(payload.rateToAccount, 'Exchange rate') : null
    );

    const created = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO loan_payments
           (user_id, loan_id, pay_date, amount, currency, fx_rate, account_amount, base_amount, account_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          user.id,
          id,
          payDate,
          rawAmount,
          currency,
          converted.fxRate,
          converted.accountAmount,
          converted.baseAmount,
          accountId,
          note
        ]
      );
      await logAudit(q, user.id, 'loan_payment', rows[0].id, 'created', {
        loanId: id,
        amount: rawAmount,
        currency,
        counterparty: loan.counterparty
      });
      return rows[0];
    });
    const updated = await getLoan(db, user.id, id);
    res.status(201).json({ id: created.id, loan: updated });
  })
);

loansRouter.delete(
  '/loans/:id/payments/:paymentId',
  asyncHandler(async (req, res) => {
    const { db, user } = getAuth(req);
    const id = uuid(req.params.id, 'Loan');
    const paymentId = uuid(req.params.paymentId, 'Repayment');
    await db.tx(async (q) => {
      const { rows } = await q.query<{ amount: string; currency: string }>(
        `DELETE FROM loan_payments WHERE id = $1 AND loan_id = $2 AND user_id = $3 RETURNING amount, currency`,
        [paymentId, id, user.id]
      );
      if (!rows[0]) throw notFound('Repayment not found.');
      await logAudit(q, user.id, 'loan_payment', paymentId, 'deleted', { loanId: id, ...rows[0] });
    });
    const loan = await getLoan(db, user.id, id);
    res.json({ ok: true, loan });
  })
);

export const __loanTestables = { todayISO, rateStr };
