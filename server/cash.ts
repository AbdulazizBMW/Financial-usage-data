import { dec, isCurrency, money, rate as rateStr } from './money.js';
import { badRequest, notFound } from './http.js';
import type { Queryable } from './db.js';

export interface AccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  opening_balance: string;
  opening_date: string;
  archived: boolean;
}

export async function accountRow(q: Queryable, userId: string, id: string): Promise<AccountRow> {
  const { rows } = await q.query<AccountRow>(
    `SELECT id, name, type, currency, opening_balance, to_char(opening_date, 'YYYY-MM-DD') AS opening_date, archived
       FROM accounts WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rows[0]) throw notFound('Account not found.');
  return rows[0];
}

export function pickCurrency(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (!isCurrency(value)) throw badRequest('Currency must be UZS or USD.');
  return value;
}

export interface CashAmounts {
  accountAmount: string;
  baseAmount: string;
  fxRate: string;
}

/**
 * Converts a user-entered amount into the account currency and the reporting
 * base currency using exact decimal arithmetic (never floating point).
 */
export function cashAmounts(
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
