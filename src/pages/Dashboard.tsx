import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Loading, PageHeader, Select, StatCard, errorMessage } from '../components/ui';
import { useAuth } from '../context/Auth';
import { api, type Dashboard as DashboardData } from '../lib/api';
import { compact, formatDate, money } from '../lib/format';

const PRESETS: { value: string; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' }
];

const PIE_COLORS = ['#1d66ef', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b', '#84cc16'];

export default function Dashboard() {
  const { user, baseCurrency } = useAuth();
  const [preset, setPreset] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .dashboard({ preset, from: preset === 'custom' ? from : undefined, to: preset === 'custom' ? to : undefined })
      .then((result) => {
        if (!cancelled) setData(result);
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
  }, [preset, from, to]);

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((point) => ({
        label: point.label,
        Income: Number(point.income),
        Expenses: Number(point.expense),
        Net: Number(point.net)
      })),
    [data]
  );

  const expensePie = useMemo(
    () => (data?.expenseByCategory ?? []).slice(0, 8).map((row) => ({ name: row.name, value: Number(row.total) })),
    [data]
  );

  const base = data?.baseCurrency ?? baseCurrency;

  return (
    <>
      <PageHeader title={`Welcome back, ${user?.name?.split(' ')[0] ?? 'there'}`} subtitle="Every figure below is calculated from your recorded transactions.">
        <Field label="Period" className="w-40">
          <Select value={preset} onChange={(event) => setPreset(event.target.value)}>
            {PRESETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {preset === 'custom' ? (
          <>
            <Field label="From" className="w-36">
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </Field>
            <Field label="To" className="w-36">
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </Field>
          </>
        ) : null}
      </PageHeader>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading label="Calculating your position…" /> : null}

      {data ? (
        <div className="space-y-5">
          {data.warnings?.length ? <Alert tone="warning">{data.warnings.join(' ')}</Alert> : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Total income" value={money(data.income, base)} tone="positive" hint={`${data.counts.income} entries`} />
            <StatCard label="Total expenses" value={money(data.expenses, base)} tone="negative" hint={`${data.counts.expense} entries`} />
            <StatCard
              label="Net cash flow"
              value={money(data.netCashFlow, base)}
              tone={Number(data.netCashFlow) >= 0 ? 'positive' : 'negative'}
              hint="Income − expenses"
            />
            <StatCard label="Available balance" value={money(data.availableBalance, base)} hint="All accounts, as of today" />
            <StatCard label="Savings (period)" value={money(data.savings, base)} hint={`Savings rate ${data.savingsRate}%`} />
            <StatCard label="Total lent" value={money(data.totalLent, base)} hint="Original loan amounts" />
            <StatCard label="Total borrowed" value={money(data.totalBorrowed, base)} hint="Original borrowing amounts" />
            <StatCard label="Outstanding receivables" value={money(data.receivables, base)} tone="warning" hint="Owed to you" />
            <StatCard label="Outstanding payables" value={money(data.payables, base)} tone="warning" hint="You owe others" />
            <StatCard
              label="Monthly savings rate"
              value={`${data.monthlySavingsRate}%`}
              tone={Number(data.monthlySavingsRate) >= 0 ? 'positive' : 'negative'}
              hint={`${data.overdueCount} overdue loan${data.overdueCount === 1 ? '' : 's'}`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Income vs expenses" subtitle="Last 12 months, consolidated in your base currency" />
              <div className="h-72 px-2 py-3">
                {trendData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                      <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No trend yet" message="Record transactions to see month-by-month comparisons." />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Expense distribution" subtitle="Selected period" />
              <div className="h-72 px-2 py-3">
                {expensePie.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={expensePie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2}>
                        {expensePie.map((entry, index) => (
                          <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No expenses recorded" message="Expense categories will appear here." />
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Recent transactions"
                subtitle={data.range?.label ?? ''}
                action={
                  <Link to="/transactions">
                    <Button variant="secondary" size="sm">
                      View all
                    </Button>
                  </Link>
                }
              />
              {data.recentTransactions?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.recentTransactions.slice(0, 8).map((txn) => (
                        <tr key={txn.id}>
                          <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDate(txn.txn_date)}</td>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-800 dark:text-slate-100">{txn.category_name ?? 'Internal transfer'}</p>
                            <p className="text-[11px] text-slate-400">
                              {txn.account_name}
                              {txn.description ? ` · ${txn.description}` : ''}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className={
                                txn.kind === 'income'
                                  ? 'font-medium tabular-nums text-emerald-600 dark:text-emerald-400'
                                  : txn.kind === 'expense'
                                    ? 'font-medium tabular-nums text-rose-600 dark:text-rose-400'
                                    : 'font-medium tabular-nums text-slate-500'
                              }
                            >
                              {txn.kind === 'expense' ? '−' : txn.kind === 'income' ? '+' : ''}
                              {money(txn.amount, txn.currency)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="Nothing recorded yet"
                  message="Add your first income or expense to bring the dashboard to life."
                  action={
                    <Link to="/transactions">
                      <Button size="sm">Add transaction</Button>
                    </Link>
                  }
                />
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Account balances" action={<Link to="/accounts" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Manage</Link>} />
                {data.accounts?.length ? (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.accounts.map((account) => (
                      <li key={account.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <div>
                          <p className="font-medium text-slate-800 dark:text-slate-100">{account.name}</p>
                          <p className="text-[11px] uppercase tracking-wide text-slate-400">{account.currency}</p>
                        </div>
                        <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{money(account.balance, account.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No accounts" message="Create a cash or bank account to start tracking balances." />
                )}
              </Card>

              <Card>
                <CardHeader title="By currency" subtitle="Original currencies, never mixed" />
                <div className="space-y-2 px-4 py-3">
                  {(data.byCurrency ?? []).length ? (
                    data.byCurrency.map((row) => (
                      <div key={row.currency} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950/60">
                        <Badge>{row.currency}</Badge>
                        <span className="text-emerald-600 dark:text-emerald-400">+{money(row.income, row.currency)}</span>
                        <span className="text-rose-600 dark:text-rose-400">−{money(row.expense, row.currency)}</span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">{money(row.net, row.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="px-1 py-2 text-xs text-slate-400">No movements in this period.</p>
                  )}
                </div>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader title="Cash flow trend" subtitle="Net result per month" />
            <div className="h-56 px-2 py-3">
              {trendData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Line type="monotone" dataKey="Net" stroke="#1d66ef" strokeWidth={2.4} dot={{ r: 2.5 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="No data" message="Your monthly net cash flow will be charted here." />
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
