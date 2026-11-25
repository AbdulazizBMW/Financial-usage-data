/**
 * End-to-end regression suite.
 *
 * Boots the real Express app against a throw-away embedded database, then drives it
 * over HTTP exactly like the browser does. Every number asserted here is produced by
 * the real accounting code paths (transactions, transfers, loans, repayments, reports).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finora-regression-'));
process.env.PGLITE_DIR = path.join(tmpDir, 'pgdata');
process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = '';
process.env.MAIL_FROM = '';

type Json = Record<string, any>;

let base = '';
let checks = 0;

function ok(label: string) {
  checks++;
  console.log(`  \u2713 ${label}`);
}

function near(actual: unknown, expected: number, label: string, tolerance = 0.005) {
  const value = Number(actual);
  if (!Number.isFinite(value) || Math.abs(value - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, received ${JSON.stringify(actual)}`);
  }
  ok(`${label} = ${expected}`);
}

function status(res: { status: number }, expected: number, label: string) {
  if (res.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${res.status} ${JSON.stringify(res.data ?? '').slice(0, 300)}`);
  }
  ok(`${label} (HTTP ${expected})`);
}

function cookieFrom(res: Response): string {
  const list = typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];
  const raw = list[0] ?? res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

type CallOptions = { body?: unknown; cookie?: string; raw?: boolean };

async function call(method: string, urlPath: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers['Cookie'] = options.cookie;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual'
  });
  const contentType = res.headers.get('content-type') ?? '';
  let data: any = null;
  let buffer: Buffer | null = null;
  if (options.raw) buffer = Buffer.from(await res.arrayBuffer());
  else if (contentType.includes('application/json')) data = await res.json();
  else data = await res.text();
  return { status: res.status, headers: res.headers, data, buffer, cookie: cookieFrom(res) } as {
    status: number;
    headers: Headers;
    data: any;
    buffer: Buffer | null;
    cookie: string;
  };
}

async function main() {
  const { createApp } = await import('../index.js');
  const { closeDb } = await import('../db.js');
  const { app, db } = await createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;

  try {
    console.log(`\n[1] Health and access control (db=${db.kind})`);
    const health = await call('GET', '/api/health');
    status(health, 200, 'health endpoint');
    assert.equal(health.data.ok, true, 'health should report ok');
    const anonymous = await call('GET', '/api/dashboard?preset=all');
    status(anonymous, 401, 'anonymous dashboard request is rejected');
    const anonymousTx = await call('GET', '/api/transactions');
    status(anonymousTx, 401, 'anonymous transactions request is rejected');

    console.log('\n[2] Registration and login');
    const email = `owner-${Date.now()}@example.com`;
    const password = 'Str0ngPass!2026';
    const registered = await call('POST', '/api/auth/register', {
      body: { name: 'Test Owner', email, password, baseCurrency: 'UZS' }
    });
    status(registered, 201, 'register user');
    assert.equal(registered.data.user.email, email);
    assert.ok(typeof registered.data.recoveryCode === 'string' && registered.data.recoveryCode.length >= 8, 'recovery code issued');
    ok('password is never echoed back', true);
    assert.equal(JSON.stringify(registered.data).includes(password), false, 'response must not contain the password');

    const login = await call('POST', '/api/auth/login', { body: { email, password } });
    status(login, 200, 'login with email and password');
    const cookie = login.cookie;
    assert.ok(cookie.includes('='), 'session cookie issued');

    const me = await call('GET', '/api/auth/me', { cookie });
    status(me, 200, 'session resolves to a user');
    assert.equal(me.data.user.email, email);

    console.log('\n[3] Accounts with opening balances');
    const cash = await call('POST', '/api/accounts', {
      cookie,
      body: { name: 'Cash', type: 'cash', currency: 'UZS', openingBalance: '1000.00', openingDate: '2026-01-05' }
    });
    status(cash, 201, 'create cash account');
    const bank = await call('POST', '/api/accounts', {
      cookie,
      body: { name: 'Bank Card', type: 'bank_card', currency: 'UZS', openingBalance: '0', openingDate: '2026-01-05' }
    });
    status(bank, 201, 'create bank account');
    const cashId = cash.data.id as string;
    const bankId = bank.data.id as string;

    const accountList = await call('GET', '/api/accounts', { cookie });
    status(accountList, 200, 'list accounts');
    const balanceOf = (id: string) => {
      const found = (accountList.data.accounts as Json[]).find((a) => a.id === id);
      assert.ok(found, `account ${id} present`);
      return found!.balance ?? found!.currentBalance ?? found!.closingBalance;
    };
    near(balanceOf(cashId), 1000, 'cash opening balance');
    near(balanceOf(bankId), 0, 'bank opening balance');

    console.log('\n[4] Income and expense tracking');
    const cats = await call('GET', '/api/categories', { cookie });
    status(cats, 200, 'default categories are provisioned');
    const categories = cats.data.categories as Json[];
    const salaryId = categories.find((c) => c.kind === 'income' && /salary/i.test(c.name))?.id;
    const foodId = categories.find((c) => c.kind === 'expense' && /food/i.test(c.name))?.id;
    assert.ok(salaryId, 'default Salary income category exists');
    assert.ok(foodId, 'default Food expense category exists');
    ok('seeded income/expense categories available');

    const income = await call('POST', '/api/transactions', {
      cookie,
      body: {
        kind: 'income',
        date: '2026-01-10',
        amount: '2000.00',
        currency: 'UZS',
        accountId: cashId,
        categoryId: salaryId,
        description: 'January salary',
        paymentMethod: 'cash'
      }
    });
    status(income, 201, 'record income');
    const incomeId = income.data.id as string;

    const expense = await call('POST', '/api/transactions', {
      cookie,
      body: {
        kind: 'expense',
        date: '2026-01-10',
        amount: '500.25',
        currency: 'UZS',
        accountId: cashId,
        categoryId: foodId,
        description: 'Groceries',
        paymentMethod: 'cash'
      }
    });
    status(expense, 201, 'record expense');
    const expenseId = expense.data.id as string;

    const invalid = await call('POST', '/api/transactions', {
      cookie,
      body: { kind: 'expense', date: '2026-01-10', amount: '-5', accountId: cashId }
    });
    status(invalid, 400, 'negative amount is rejected');

    console.log('\n[5] Dashboard totals, daily totals and net cash flow');
    const dashAll = await call('GET', '/api/dashboard?preset=all', { cookie });
    status(dashAll, 200, 'all-time dashboard');
    near(dashAll.data.income, 2000, 'total income');
    near(dashAll.data.expenses, 500.25, 'total expenses');
    near(dashAll.data.netCashFlow, 1499.75, 'net cash flow');
    near(dashAll.data.availableBalance, 2499.75, 'available balance');

    const dayTotals = await call('GET', '/api/dashboard?from=2026-01-10&to=2026-01-10', { cookie });
    status(dayTotals, 200, 'single-day dashboard');
    near(dayTotals.data.income, 2000, 'daily income');
    near(dayTotals.data.expenses, 500.25, 'daily expenses');
    near(dayTotals.data.netCashFlow, 1499.75, 'daily net cash flow');

    console.log('\n[6] Transfers are neither income nor expenses');
    const transfer = await call('POST', '/api/transfers', {
      cookie,
      body: { date: '2026-01-11', fromAccountId: cashId, toAccountId: bankId, amount: '300.00', description: 'Top up card' }
    });
    status(transfer, 201, 'transfer between own accounts');
    const afterTransfer = await call('GET', '/api/accounts', { cookie });
    const balAfter = (id: string) => {
      const found = (afterTransfer.data.accounts as Json[]).find((a) => a.id === id)!;
      return found.balance ?? found.currentBalance ?? found.closingBalance;
    };
    near(balAfter(cashId), 2199.75, 'cash after transfer');
    near(balAfter(bankId), 300, 'bank after transfer');
    const dashTransfer = await call('GET', '/api/dashboard?preset=all', { cookie });
    near(dashTransfer.data.income, 2000, 'transfer does not add income');
    near(dashTransfer.data.expenses, 500.25, 'transfer does not add expense');
    near(dashTransfer.data.availableBalance, 2499.75, 'transfer leaves total balance unchanged');

    console.log('\n[7] Lending, partial repayment and receivables');
    const lend = await call('POST', '/api/loans', {
      cookie,
      body: {
        direction: 'lend',
        counterparty: 'Ali Karimov',
        amount: '400.00',
        currency: 'UZS',
        accountId: cashId,
        date: '2026-01-12',
        dueDate: '2026-02-12',
        description: 'Short term loan',
        notes: 'Will repay after salary'
      }
    });
    status(lend, 201, 'record money lent');
    const lendId = lend.data.id as string;

    const lendList = await call('GET', '/api/loans?direction=lend', { cookie });
    status(lendList, 200, 'list lending records');
    near(lendList.data.totals.totalLent, 400, 'total lent');
    near(lendList.data.totals.receivables, 400, 'outstanding receivables after lending');
    const dashLend = await call('GET', '/api/dashboard?preset=all', { cookie });
    near(dashLend.data.expenses, 500.25, 'lending is not an expense');
    near(dashLend.data.income, 2000, 'lending is not income');
    near(dashLend.data.totalLent, 400, 'dashboard total lent');
    const accountsAfterLend = await call('GET', '/api/accounts', { cookie });
    near(
      (accountsAfterLend.data.accounts as Json[]).find((a) => a.id === cashId)!.balance,
      1799.75,
      'cash reduced by the amount lent'
    );

    const repayIn = await call('POST', `/api/loans/${lendId}/payments`, {
      cookie,
      body: { date: '2026-01-20', amount: '150.00', accountId: cashId, note: 'First instalment' }
    });
    status(repayIn, 201, 'record partial loan repayment');
    const lendAfterPart = await call('GET', '/api/loans?direction=lend', { cookie });
    near(lendAfterPart.data.totals.receivables, 250, 'receivables after partial repayment');
    const dashAfterPart = await call('GET', '/api/dashboard?preset=all', { cookie });
    near(dashAfterPart.data.income, 2000, 'loan repayment received is not new income');
    const accountsAfterPart = await call('GET', '/api/accounts', { cookie });
    near(
      (accountsAfterPart.data.accounts as Json[]).find((a) => a.id === cashId)!.balance,
      1949.75,
      'cash increased by the repayment received'
    );

    const overpay = await call('POST', `/api/loans/${lendId}/payments`, {
      cookie,
      body: { date: '2026-01-21', amount: '999.00', accountId: cashId }
    });
    status(overpay, 400, 'repayment above the outstanding balance is rejected');

    console.log('\n[8] Borrowing and repayments');
    const borrow = await call('POST', '/api/loans', {
      cookie,
      body: {
        direction: 'borrow',
        counterparty: 'Vali Toshev',
        amount: '1000.00',
        currency: 'UZS',
        accountId: bankId,
        date: '2026-01-15',
        dueDate: '2026-03-15',
        description: 'Borrowed for laptop'
      }
    });
    status(borrow, 201, 'record money borrowed');
    const borrowId = borrow.data.id as string;

    const borrowList = await call('GET', '/api/loans?direction=borrow', { cookie });
    status(borrowList, 200, 'list borrowing records');
    near(borrowList.data.totals.totalBorrowed, 1000, 'total borrowed');
    near(borrowList.data.totals.payables, 1000, 'outstanding payables after borrowing');
    const dashBorrow = await call('GET', '/api/dashboard?preset=all', { cookie });
    near(dashBorrow.data.income, 2000, 'borrowing is not income');
    near(dashBorrow.data.totalBorrowed, 1000, 'dashboard total borrowed');

    const repayOut = await call('POST', `/api/loans/${borrowId}/payments`, {
      cookie,
      body: { date: '2026-01-25', amount: '400.00', accountId: bankId }
    });
    status(repayOut, 201, 'repay part of a borrowing');
    const borrowAfter = await call('GET', '/api/loans?direction=borrow', { cookie });
    near(borrowAfter.data.totals.payables, 600, 'payables after repayment');
    const dashAfterRepay = await call('GET', '/api/dashboard?preset=all', { cookie });
    near(dashAfterRepay.data.expenses, 500.25, 'loan repayment made is not an expense');

    console.log('\n[9] Balance reconciliation');
    const reconciled = await call('GET', '/api/dashboard?preset=all', { cookie });
    // 1000 opening + 1499.75 net cash flow - 400 lent + 150 received + 1000 borrowed - 400 repaid
    near(reconciled.data.availableBalance, 2849.75, 'available balance reconciles with every cash movement');
    const accountSum = (reconciled.data.accounts as Json[]).reduce((sum, a) => sum + Number(a.balance), 0);
    near(accountSum, 2849.75, 'sum of account balances matches the dashboard');
    near(reconciled.data.receivables, 250, 'dashboard receivables');
    near(reconciled.data.payables, 600, 'dashboard payables');

    console.log('\n[10] Monthly finance page data');
    const monthly = await call('GET', '/api/reports/monthly.json?month=2026-01', { cookie });
    status(monthly, 200, 'monthly summary');
    const month = monthly.data.monthly as Json;
    near(month.income, 2000, 'monthly income');
    near(month.expenses, 500.25, 'monthly expenses');
    near(month.netCashFlow, 1499.75, 'monthly net cash flow');
    near(month.closingBalance, 2849.75, 'monthly closing balance');
    near(month.openingBalance, 1000, 'monthly opening balance');

    console.log('\n[11] Report downloads (PDF, XLSX, CSV)');
    const pdf = await call('GET', '/api/reports/monthly.pdf?month=2026-01', { cookie, raw: true });
    status(pdf, 200, 'monthly PDF report');
    assert.equal(pdf.buffer!.subarray(0, 5).toString('latin1'), '%PDF-', 'PDF has a valid header');
    assert.ok(pdf.buffer!.length > 3000, 'PDF has real content');
    ok(`PDF size ${pdf.buffer!.length} bytes`);

    const xlsx = await call('GET', '/api/reports/monthly.xlsx?month=2026-01', { cookie, raw: true });
    status(xlsx, 200, 'monthly Excel report');
    assert.equal(xlsx.buffer!.subarray(0, 2).toString('latin1'), 'PK', 'XLSX is a valid zip container');
    ok(`XLSX size ${xlsx.buffer!.length} bytes`);

    const csv = await call('GET', '/api/reports/transactions.csv?month=2026-01', { cookie, raw: true });
    status(csv, 200, 'CSV transaction export');
    const csvText = csv.buffer!.toString('utf8');
    assert.ok(csvText.includes('2026-01-10'), 'CSV contains the recorded transaction dates');
    assert.ok(csvText.includes('2000'), 'CSV contains the recorded income amount');
    ok('CSV contains real transaction rows');

    console.log('\n[12] Full repayment closes the loan');
    const finalPay = await call('POST', `/api/loans/${lendId}/payments`, {
      cookie,
      body: { date: '2026-01-28', amount: '250.00', accountId: cashId }
    });
    status(finalPay, 201, 'record final repayment');
    const lendClosed = await call('GET', '/api/loans?direction=lend', { cookie });
    near(lendClosed.data.totals.receivables, 0, 'receivables are zero after full repayment');

    console.log('\n[13] Logout, session expiry and persistence');
    const logout = await call('POST', '/api/auth/logout', { cookie });
    status(logout, 200, 'logout');
    const afterLogout = await call('GET', '/api/auth/me', { cookie });
    status(afterLogout, 401, 'session is invalid after logout');
    const relogin = await call('POST', '/api/auth/login', { body: { email, password } });
    status(relogin, 200, 'log back in');
    const cookie2 = relogin.cookie;
    const persisted = await call('GET', '/api/dashboard?preset=all', { cookie: cookie2 });
    near(persisted.data.income, 2000, 'income survives logout/login');
    near(persisted.data.expenses, 500.25, 'expenses survive logout/login');

    console.log('\n[14] Manual backup, deletion and restore');
    const backup = await call('POST', '/api/backups', { cookie: cookie2 });
    status(backup, 201, 'create manual backup');
    const backupId = backup.data.backup.id as string;
    const backupList = await call('GET', '/api/backups', { cookie: cookie2 });
    status(backupList, 200, 'list backups');
    assert.ok((backupList.data.backups as Json[]).some((b) => b.id === backupId), 'new backup is listed');
    const download = await call('GET', `/api/backups/${backupId}/download`, { cookie: cookie2 });
    status(download, 200, 'download backup file');
    assert.ok(Array.isArray(download.data.transactions), 'backup payload contains the transaction table');
    ok(`backup holds ${download.data.transactions.length} transactions`);

    const del = await call('DELETE', `/api/transactions/${expenseId}`, { cookie: cookie2 });
    status(del, 200, 'delete a transaction');
    const afterDelete = await call('GET', '/api/dashboard?preset=all', { cookie: cookie2 });
    near(afterDelete.data.expenses, 0, 'expense removed after deletion');

    const restore = await call('POST', '/api/backups/restore', { cookie: cookie2, body: { confirm: true, backupId } });
    status(restore, 200, 'restore from backup');
    const afterRestore = await call('GET', '/api/dashboard?preset=all', { cookie: cookie2 });
    near(afterRestore.data.expenses, 500.25, 'deleted expense is recovered by the restore');
    near(afterRestore.data.income, 2000, 'income is intact after restore');

    console.log('\n[15] User data isolation');
    const otherEmail = `intruder-${Date.now()}@example.com`;
    const other = await call('POST', '/api/auth/register', {
      body: { name: 'Other User', email: otherEmail, password, baseCurrency: 'UZS' }
    });
    status(other, 201, 'register second user');
    const otherLogin = await call('POST', '/api/auth/login', { body: { email: otherEmail, password } });
    status(otherLogin, 200, 'second user login');
    const otherCookie = otherLogin.cookie;

    const otherDash = await call('GET', '/api/dashboard?preset=all', { cookie: otherCookie });
    status(otherDash, 200, 'second user dashboard');
    near(otherDash.data.income, 0, 'second user sees no income from the first user');
    near(otherDash.data.availableBalance, 0, 'second user sees no balances from the first user');
    const otherTx = await call('GET', '/api/transactions', { cookie: otherCookie });
    assert.equal((otherTx.data.transactions as Json[]).length, 0, 'second user has no transactions');
    ok('second user transaction list is empty');
    const otherLoans = await call('GET', '/api/loans?direction=lend', { cookie: otherCookie });
    assert.equal((otherLoans.data.loans as Json[]).length, 0, 'second user has no loans');
    ok('second user loan list is empty');

    const steal = await call('PATCH', `/api/transactions/${incomeId}`, {
      cookie: otherCookie,
      body: { amount: '1.00' }
    });
    status(steal, 404, 'another user cannot edit a foreign transaction');
    const stealDelete = await call('DELETE', `/api/transactions/${incomeId}`, { cookie: otherCookie });
    status(stealDelete, 404, 'another user cannot delete a foreign transaction');
    const stealLoan = await call('POST', `/api/loans/${lendId}/payments`, {
      cookie: otherCookie,
      body: { date: '2026-01-29', amount: '10.00', accountId: cashId }
    });
    status(stealLoan, 404, 'another user cannot post a repayment to a foreign loan');

    const stillThere = await call('GET', '/api/dashboard?preset=all', { cookie: cookie2 });
    near(stillThere.data.income, 2000, 'first user data is untouched by the intruder');

    console.log(`\nAll ${checks} checks passed. Database: ${db.kind} (${db.durable ? 'durable' : 'non-durable'}).`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nRegression suite FAILED:', (error as Error).message);
  process.exit(1);
});
