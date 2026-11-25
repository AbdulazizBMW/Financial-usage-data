import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Loading, PageHeader, Select, StatCard, TableShell, errorMessage } from '../components/ui';
import { api, downloadUrl, type MonthlyData } from '../lib/api';
import { compact, currentMonth, formatDate, money, monthLabel, statusLabel, statusTone } from '../lib/format';

const monthOptions = (count: number) => {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

export default function Monthly() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const options = useMemo(() => monthOptions(30), []);

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

  const chartData = (data?.trend ?? []).map((point) => ({
    label: point.label,
    Income: Number(point.income),
    Expenses: Number(point.expense)
  }));

  return (
    <>
      <PageHeader title="Monthly finance" subtitle="Opening and closing balances, category breakdowns and the full daily history for a month.">
        <Field label="Month" className="w-48">
          <Select value={month} onChange={(event) => setMonth(event.target.value)}>
            {options.map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Link to="/reports">
          <Button variant="secondary">Reports</Button>
        </Link>
        <a href={downloadUrl.pdf(month)} target="_blank" rel="noreferrer">
          <Button>Download monthly report</Button>
        </a>
      </PageHeader>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading label="Building the month…" /> : null}

      {data ? (
        <div className="space-y-5">
          {data.warnings?.length ? <Alert tone="warning">{data.warnings.join(' ')}</Alert> : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Opening balance" value={money(data.openingBalance, base)} hint={`As of ${formatDate(data.from)}`} />
            <StatCard label="Income" value={money(data.income, base)} tone="positive" />
            <StatCard label="Expenses" value={money(data.expenses, base)} tone="negative" />
            <StatCard
              label="Net cash flow"
              value={money(data.netCashFlow, base)}
              tone={Number(data.netCashFlow) >= 0 ? 'positive' : 'negative'}
            />
            <StatCard label="Closing balance" value={money(data.closingBalance, base)} hint={`As of ${formatDate(data.to)}`} />
            <StatCard label="Savings" value={money(data.savings, base)} hint={`Savings rate ${data.savingsRate}%`} />
            <StatCard label="Lent this month" value={money(data.lentInMonth, base)} hint="Not an expense" />
            <StatCard label="Borrowed this month" value={money(data.borrowedInMonth, base)} hint="Not income" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Income vs expenses" subtitle="Selected month compared with the previous month" />
              <div className="h-64 px-2 py-3">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                      <Tooltip formatter={(value) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No comparison data" message="Record movements to compare months." />
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
                <div>
                  <p className="text-slate-400">{data.comparison?.previousLabel ?? 'Previous month'}</p>
                  <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{money(data.comparison?.income ?? 0, base)} income</p>
                </div>
                <div>
                  <p className="text-slate-400">Expenses then</p>
                  <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{money(data.comparison?.expenses ?? 0, base)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Net then</p>
                  <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{money(data.comparison?.netCashFlow ?? 0, base)}</p>
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Income breakdown" />
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.incomeByCategory?.length ? (
                    data.incomeByCategory.map((row) => (
                      <li key={row.id ?? row.name} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="text-slate-600 dark:text-slate-300">{row.name}</span>
                        <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{money(row.total, base)}</span>
                      </li>
                    ))
                  ) : (
                    <li className="px-4 py-3 text-xs text-slate-400">No income in this month.</li>
                  )}
                </ul>
              </Card>
              <Card>
                <CardHeader title="Expense breakdown" />
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.expenseByCategory?.length ? (
                    data.expenseByCategory.map((row) => (
                      <li key={row.id ?? row.name} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="text-slate-600 dark:text-slate-300">{row.name}</span>
                        <span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">{money(row.total, base)}</span>
                      </li>
                    ))
                  ) : (
                    <li className="px-4 py-3 text-xs text-slate-400">No expenses in this month.</li>
                  )}
                </ul>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader title="Daily transaction history" subtitle={`${data.transactions?.length ?? 0} movements in ${data.label}`} />
            {data.transactions?.length ? (
              <TableShell
                head={
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 text-right font-medium">In base</th>
                  </tr>
                }
              >
                {data.transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(txn.txn_date)}</td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          txn.kind === 'income'
                            ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
                            : txn.kind === 'expense'
                              ? 'bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400'
                              : 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300'
                        }
                      >
                        {txn.kind}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{txn.category_name ?? 'Internal transfer'}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{txn.account_name}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(txn.amount, txn.currency)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{money(txn.base_amount, base)}</td>
                  </tr>
                ))}
              </TableShell>
            ) : (
              <EmptyState title="No transactions" message="Nothing was recorded in this month." />
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Money lent this month" action={<Link to="/lending" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Open lending</Link>} />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.lendLoans?.length ? (
                  data.lendLoans.map((loan) => (
                    <li key={loan.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-100">{loan.counterparty}</p>
                        <p className="text-[11px] text-slate-400">Outstanding {money(loan.outstanding, loan.currency)}</p>
                      </div>
                      <Badge tone={statusTone(loan.status)}>{statusLabel(loan.status)}</Badge>
                    </li>
                  ))
                ) : (
                  <li className="px-4 py-3 text-xs text-slate-400">No lending in this month.</li>
                )}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Money borrowed this month" action={<Link to="/borrowing" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Open borrowing</Link>} />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.borrowLoans?.length ? (
                  data.borrowLoans.map((loan) => (
                    <li key={loan.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-100">{loan.counterparty}</p>
                        <p className="text-[11px] text-slate-400">Outstanding {money(loan.outstanding, loan.currency)}</p>
                      </div>
                      <Badge tone={statusTone(loan.status)}>{statusLabel(loan.status)}</Badge>
                    </li>
                  ))
                ) : (
                  <li className="px-4 py-3 text-xs text-slate-400">No borrowing in this month.</li>
                )}
              </ul>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
