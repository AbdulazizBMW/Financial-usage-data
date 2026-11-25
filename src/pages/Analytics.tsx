import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
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
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  StatCard,
  TableShell,
  errorMessage
} from '../components/ui';
import { api, type Account, type CategoryTotal, type TrendPoint } from '../lib/api';
import { compact, formatDate, money } from '../lib/format';

interface DailyPoint {
  date: string;
  income: string;
  expense: string;
  net: string;
}

interface YearRow {
  year: string;
  income: string;
  expense: string;
  net: string;
}

interface AnalyticsData {
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
  totalBorrowed: string;
  daily: DailyPoint[];
  trend: TrendPoint[];
  yearly: YearRow[];
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  byCurrency: { currency: string; income: string; expense: string; net: string }[];
  accounts: Account[];
  accountHistory: { month: string; label: string; total: string; accounts: { name: string; balance: string }[] }[];
  insights: string[];
  warnings: string[];
}

const PALETTE = ['#1d66ef', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

const RANGES = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' }
];

export default function Analytics() {
  const [preset, setPreset] = useState('this_year');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .analytics({ preset })
      .then((result) => {
        if (!cancelled) setData(result as unknown as AnalyticsData);
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
  }, [preset]);

  const base = data?.baseCurrency ?? 'UZS';

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

  const dailyData = useMemo(
    () =>
      (data?.daily ?? []).map((point) => ({
        label: point.date.slice(5),
        Income: Number(point.income),
        Expenses: Number(point.expense)
      })),
    [data]
  );

  const expensePie = useMemo(
    () => (data?.expenseByCategory ?? []).map((row) => ({ name: row.name, value: Number(row.total) })),
    [data]
  );

  const accountHistory = useMemo(() => {
    const history = data?.accountHistory ?? [];
    return history.map((entry) => ({
      label: entry.label,
      Balance: Number(entry.total)
    }));
  }, [data]);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Interactive trends, category distribution and insights generated from your own records.">
        <Field label="Period" className="w-44">
          <Select value={preset} onChange={(event) => setPreset(event.target.value)}>
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </Select>
        </Field>
      </PageHeader>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading label="Crunching the numbers…" /> : null}

      {data ? (
        <div className="space-y-5">
          {data.warnings?.length ? <Alert tone="warning">{data.warnings.join(' ')}</Alert> : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Income" value={money(data.income, base)} tone="positive" hint={data.range.label} />
            <StatCard label="Expenses" value={money(data.expenses, base)} tone="negative" />
            <StatCard label="Net cash flow" value={money(data.netCashFlow, base)} tone={Number(data.netCashFlow) >= 0 ? 'positive' : 'negative'} />
            <StatCard label="Savings" value={money(data.savings, base)} hint={`Savings rate ${data.savingsRate}%`} />
            <StatCard label="Receivables" value={money(data.receivables, base)} hint={`Lent ${money(data.totalLent, base)}`} />
            <StatCard label="Payables" value={money(data.payables, base)} hint={`Borrowed ${money(data.totalBorrowed, base)}`} />
            <StatCard label="Accounts" value={String(data.accounts?.length ?? 0)} hint="Active financial accounts" />
            <StatCard label="Currencies" value={(data.byCurrency ?? []).map((row) => row.currency).join(', ') || '—'} hint="Kept separate from each other" />
          </div>

          <Card>
            <CardHeader title="Monthly cash flow trend" subtitle="Income, expenses and net result across recent months" />
            <div className="h-72 px-2 py-3">
              {trendData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={54} />
                    <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="Net" stroke="#1d66ef" strokeWidth={2} dot={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="Nothing to chart yet" message="Record income and expenses to build monthly trends." />
              )}
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Daily income and expenses" subtitle={data.range.label} />
              <div className="h-64 px-2 py-3">
                {dailyData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                        </linearGradient>
                        <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={54} />
                      <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="Income" stroke="#10b981" fill="url(#incomeGradient)" strokeWidth={2} />
                      <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#expenseGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No daily movements" message="Transactions in this period will appear here." />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Expense distribution" subtitle="Where the money goes" />
              <div className="h-64 px-2 py-3">
                {expensePie.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={expensePie} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="78%" paddingAngle={2}>
                        {expensePie.map((entry, index) => (
                          <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No expenses" message="Category distribution appears once you record spending." />
                )}
              </div>
              {expensePie.length ? (
                <ul className="space-y-1.5 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                  {expensePie.slice(0, 5).map((row, index) => (
                    <li key={row.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                        <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} />
                        {row.name}
                      </span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">{money(row.value, base)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Account balance history" subtitle="Total balance at recent month ends" />
              <div className="h-56 px-2 py-3">
                {accountHistory.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={accountHistory} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={54} />
                      <Tooltip formatter={(value: number) => money(value, base)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Line type="monotone" dataKey="Balance" stroke="#1d66ef" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No balance history" message="Account balances appear once accounts exist." />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Insights" subtitle="Automatically derived from your data" />
              <ul className="space-y-2 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                {(data.insights ?? []).map((insight) => (
                  <li key={insight} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span>{insight}</span>
                  </li>
                ))}
                {!data.insights?.length ? <li className="text-xs text-slate-400">No insights yet.</li> : null}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Yearly summary" />
              {data.yearly?.length ? (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 font-medium">Year</th>
                      <th className="px-4 py-2 text-right font-medium">Income</th>
                      <th className="px-4 py-2 text-right font-medium">Expenses</th>
                      <th className="px-4 py-2 text-right font-medium">Net</th>
                    </tr>
                  }
                >
                  {data.yearly.map((row) => (
                    <tr key={row.year}>
                      <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-200">{row.year}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(row.income, base)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{money(row.expense, base)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(row.net, base)}</td>
                    </tr>
                  ))}
                </TableShell>
              ) : (
                <EmptyState title="No yearly data" message="Add transactions to see annual totals." />
              )}
            </Card>

            <Card>
              <CardHeader title="Currency breakdown" subtitle="Totals are never merged across currencies" />
              {data.byCurrency?.length ? (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 font-medium">Currency</th>
                      <th className="px-4 py-2 text-right font-medium">Income</th>
                      <th className="px-4 py-2 text-right font-medium">Expenses</th>
                      <th className="px-4 py-2 text-right font-medium">Net</th>
                    </tr>
                  }
                >
                  {data.byCurrency.map((row) => (
                    <tr key={row.currency}>
                      <td className="px-4 py-2">
                        <Badge>{row.currency}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(row.income, row.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(row.expense, row.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(row.net, row.currency)}</td>
                    </tr>
                  ))}
                </TableShell>
              ) : (
                <EmptyState title="No currency activity" message="Record a transaction to see per-currency totals." />
              )}
              <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400 dark:border-slate-800">
                Consolidated figures use your saved exchange rates as of each transaction date.
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Account balances" subtitle="Current position of each account" />
            {data.accounts?.length ? (
              <TableShell
                head={
                  <tr>
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-4 py-2 font-medium">Currency</th>
                    <th className="px-4 py-2 text-right font-medium">Balance</th>
                    <th className="px-4 py-2 text-right font-medium">In base</th>
                  </tr>
                }
              >
                {data.accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-200">{account.name}</td>
                    <td className="px-4 py-2">
                      <Badge>{account.currency}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(account.balance, account.currency)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{money(account.baseBalance, base)}</td>
                  </tr>
                ))}
              </TableShell>
            ) : (
              <EmptyState title="No accounts" message="Create an account to start tracking balances." />
            )}
          </Card>

          <p className="text-[11px] text-slate-400">
            Period: {formatDate(data.range.from)} — {formatDate(data.range.to)} · Base currency {base}
          </p>
        </div>
      ) : null}
    </>
  );
}
