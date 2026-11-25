import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Loading, PageHeader, Select, StatCard, TableShell, errorMessage } from '../components/ui';
import { api, downloadUrl, type MonthlyData } from '../lib/api';
import { currentMonth, formatDate, money, monthLabel } from '../lib/format';

const monthOptions = (count: number) => {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

const CONTENTS = [
  'User name and reporting period',
  'Opening and closing balances',
  'Total income, expenses and net cash flow',
  'Savings and savings rate',
  'Income and expense breakdown by category',
  'Every daily transaction',
  'Lending and borrowing summaries',
  'Outstanding receivables and payables',
  'Account balances',
  'Charts and a short financial analysis'
];

export default function Reports() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const options = useMemo(() => monthOptions(36), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .monthly(month)
      .then((result) => {
        if (!cancelled) setData(result.monthly);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const base = data?.baseCurrency ?? 'UZS';
  const label = monthLabel(month);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Download a professional monthly report generated from your live database records — never sample data."
      />

      <Card className="mb-4 border-brand-200 bg-gradient-to-br from-brand-50 to-white dark:border-brand-900/50 dark:from-brand-950/40 dark:to-slate-900">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Monthly report</h2>
            <p className="max-w-lg text-xs text-slate-500 dark:text-slate-400">
              Choose a month and download it as PDF, Excel or CSV. Each export includes every movement recorded in that month.
            </p>
            <Field label="Month and year" className="max-w-xs">
              <Select value={month} onChange={(event) => setMonth(event.target.value)}>
                {options.map((value) => (
                  <option key={value} value={value}>
                    {monthLabel(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <a href={downloadUrl.pdf(month)} target="_blank" rel="noreferrer" className="w-full sm:w-auto">
              <Button size="lg" className="w-full px-6 py-3 text-sm font-semibold tracking-wide sm:w-auto">DOWNLOAD MONTHLY REPORT</Button>
            </a>
            <div className="flex flex-wrap gap-2">
              <a href={downloadUrl.xlsx(month)} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  Excel (XLSX)
                </Button>
              </a>
              <a href={downloadUrl.csv(month)} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  CSV
                </Button>
              </a>
            </div>
            <p className="text-[11px] text-slate-400">PDF · XLSX with 7 worksheets · CSV of all transactions</p>
          </div>
        </div>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading label="Preparing report preview…" /> : null}

      {data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Opening balance" value={money(data.openingBalance, base)} hint={formatDate(data.from)} />
            <StatCard label="Income" value={money(data.income, base)} tone="positive" />
            <StatCard label="Expenses" value={money(data.expenses, base)} tone="negative" />
            <StatCard label="Net cash flow" value={money(data.netCashFlow, base)} tone={Number(data.netCashFlow) >= 0 ? 'positive' : 'negative'} />
            <StatCard label="Closing balance" value={money(data.closingBalance, base)} hint={formatDate(data.to)} />
            <StatCard label="Savings" value={money(data.savings, base)} hint={`Rate ${data.savingsRate}%`} />
            <StatCard label="Receivables" value={money(data.receivables, base)} />
            <StatCard label="Payables" value={money(data.payables, base)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title={`Report preview — ${label}`} subtitle={`${data.transactions?.length ?? 0} transactions will be included`} />
              {data.transactions?.length ? (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  }
                >
                  {data.transactions.slice(0, 12).map((txn) => (
                    <tr key={txn.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(txn.txn_date)}</td>
                      <td className="px-4 py-2">
                        <Badge
                          tone={
                            txn.kind === 'income'
                              ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
                              : txn.kind === 'expense'
                                ? 'bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400'
                                : ''
                          }
                        >
                          {txn.kind}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{txn.category_name ?? 'Internal transfer'}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(txn.amount, txn.currency)}</td>
                    </tr>
                  ))}
                </TableShell>
              ) : (
                <EmptyState title="No transactions in this month" message="The report will still generate with zero totals." />
              )}
              {data.transactions?.length > 12 ? (
                <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
                  Showing the first 12 rows — the download contains all {data.transactions.length}.
                </p>
              ) : null}
            </Card>

            <Card>
              <CardHeader title="What the PDF contains" />
              <ul className="space-y-1.5 px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                {CONTENTS.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400 dark:border-slate-800">
                Excel workbook sheets: Dashboard Summary, Income, Expenses, Lending, Borrowing, Account Balances, Daily Transactions.
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Category breakdown" subtitle="Included in both PDF and Excel exports" />
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Income</p>
                  <ul className="space-y-1 text-xs">
                    {data.incomeByCategory?.length ? (
                      data.incomeByCategory.map((row) => (
                        <li key={row.id ?? row.name} className="flex justify-between gap-2">
                          <span className="truncate text-slate-600 dark:text-slate-300">{row.name}</span>
                          <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{money(row.total, base)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-slate-400">None</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">Expenses</p>
                  <ul className="space-y-1 text-xs">
                    {data.expenseByCategory?.length ? (
                      data.expenseByCategory.map((row) => (
                        <li key={row.id ?? row.name} className="flex justify-between gap-2">
                          <span className="truncate text-slate-600 dark:text-slate-300">{row.name}</span>
                          <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{money(row.total, base)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-slate-400">None</li>
                    )}
                  </ul>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Account balances at month end" />
              {data.accounts?.length ? (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 font-medium">Account</th>
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                    </tr>
                  }
                >
                  {data.accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{account.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(account.balance, account.currency)}</td>
                    </tr>
                  ))}
                </TableShell>
              ) : (
                <EmptyState title="No accounts" message="Add an account to include balances in reports." />
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
