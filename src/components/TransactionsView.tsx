import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatCard,
  TableShell,
  Textarea,
  errorMessage,
  useToast
} from './ui';
import { api, type Account, type Category, type Txn } from '../lib/api';
import { formatDate, money, paymentLabel, todayISO } from '../lib/format';
import { useAuth } from '../context/Auth';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' }
];

const SORTS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Largest amount' },
  { value: 'amount_asc', label: 'Smallest amount' }
];

interface FormState {
  kind: 'income' | 'expense';
  date: string;
  amount: string;
  currency: string;
  accountId: string;
  categoryId: string;
  description: string;
  paymentMethod: string;
  rateToAccount: string;
}

const emptyForm = (kind: 'income' | 'expense', currency: string): FormState => ({
  kind,
  date: todayISO(),
  amount: '',
  currency,
  accountId: '',
  categoryId: '',
  description: '',
  paymentMethod: 'cash',
  rateToAccount: ''
});

export default function TransactionsView({ fixedKind }: { fixedKind?: 'income' | 'expense' }) {
  const { baseCurrency } = useAuth();
  const toast = useToast();
  const [preset, setPreset] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date_desc');

  const [rows, setRows] = useState<Txn[]>([]);
  const [summary, setSummary] = useState<Record<string, string | number>>({});
  const [daily, setDaily] = useState<{ date: string; income: string; expense: string; net: string }[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(fixedKind ?? 'expense', baseCurrency));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<Txn | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ date: todayISO(), fromAccountId: '', toAccountId: '', amount: '', toAmount: '', description: '' });
  const [transferError, setTransferError] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, cats, accs] = await Promise.all([
        api.transactions({
          preset,
          from: preset === 'custom' ? from : undefined,
          to: preset === 'custom' ? to : undefined,
          kind: fixedKind ?? (kind || undefined),
          categoryId: categoryId || undefined,
          accountId: accountId || undefined,
          search: search.trim() || undefined,
          sort
        }),
        api.categories(),
        api.accounts()
      ]);
      setRows(list.transactions);
      setSummary(list.summary);
      setDaily(list.daily ?? []);
      setCategories(cats.categories);
      setAccounts(accs.accounts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [preset, from, to, kind, categoryId, accountId, search, sort, fixedKind]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeKind = fixedKind ?? form.kind;
  const availableCategories = useMemo(() => categories.filter((c) => c.kind === activeKind), [categories, activeKind]);

  const openCreate = () => {
    const fallbackKind = fixedKind ?? 'expense';
    const defaultAccount = accounts[0];
    setEditing(null);
    setForm({
      ...emptyForm(fallbackKind, defaultAccount?.currency ?? baseCurrency),
      accountId: defaultAccount?.id ?? '',
      categoryId: categories.find((c) => c.kind === fallbackKind)?.id ?? ''
    });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (txn: Txn) => {
    if (txn.kind === 'transfer') return;
    setEditing(txn);
    setForm({
      kind: txn.kind,
      date: txn.txn_date,
      amount: String(Number(txn.amount)),
      currency: txn.currency,
      accountId: txn.account_id,
      categoryId: txn.category_id ?? '',
      description: txn.description ?? '',
      paymentMethod: txn.payment_method ?? 'cash',
      rateToAccount: ''
    });
    setFormError('');
    setFormOpen(true);
  };

  const selectedAccount = accounts.find((a) => a.id === form.accountId);
  const needsRate = Boolean(selectedAccount && form.currency !== selectedAccount.currency);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.accountId) {
      setFormError('Choose the account this movement belongs to.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        kind: fixedKind ?? form.kind,
        date: form.date,
        amount: form.amount,
        currency: form.currency,
        accountId: form.accountId,
        categoryId: form.categoryId || null,
        description: form.description,
        paymentMethod: form.paymentMethod
      };
      if (needsRate && form.rateToAccount) payload.rateToAccount = form.rateToAccount;
      if (editing) {
        await api.updateTransaction(editing.id, payload);
        toast.push('Transaction updated.');
      } else {
        await api.createTransaction(payload);
        toast.push('Transaction recorded.');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await api.deleteTransaction(deleting.id);
      toast.push('Transaction deleted.');
      setDeleting(null);
      await load();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setBusyDelete(false);
    }
  };

  const submitTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    setTransferError('');
    setTransferBusy(true);
    try {
      await api.transfer({
        date: transfer.date,
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amount: transfer.amount,
        toAmount: transfer.toAmount || undefined,
        description: transfer.description
      });
      toast.push('Transfer recorded.');
      setTransferOpen(false);
      setTransfer({ date: todayISO(), fromAccountId: '', toAccountId: '', amount: '', toAmount: '', description: '' });
      await load();
    } catch (err) {
      setTransferError(errorMessage(err));
    } finally {
      setTransferBusy(false);
    }
  };

  const title = fixedKind === 'income' ? 'Income' : fixedKind === 'expense' ? 'Expenses' : 'Daily transactions';

  return (
    <>
      <PageHeader title={title} subtitle="Search, filter and correct any recorded movement. Dashboard figures update instantly.">
        {fixedKind ? null : (
          <Button variant="secondary" onClick={() => setTransferOpen(true)}>
            Transfer between accounts
          </Button>
        )}
        <Button onClick={openCreate}>{fixedKind === 'income' ? 'Add income' : fixedKind === 'expense' ? 'Add expense' : 'Add transaction'}</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Income" value={money(String(summary.income ?? 0), baseCurrency)} tone="positive" hint={`${summary.incomeCount ?? 0} entries`} />
        <StatCard label="Expenses" value={money(String(summary.expenses ?? 0), baseCurrency)} tone="negative" hint={`${summary.expenseCount ?? 0} entries`} />
        <StatCard
          label="Net cash flow"
          value={money(String(summary.netCashFlow ?? 0), baseCurrency)}
          tone={Number(summary.netCashFlow ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Transfers" value={String(summary.transferCount ?? 0)} hint="Never counted as income or expense" />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Field label="Period">
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
              <Field label="From">
                <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </Field>
              <Field label="To">
                <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </Field>
            </>
          ) : null}
          {fixedKind ? null : (
            <Field label="Type">
              <Select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">All types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfers</option>
              </Select>
            </Field>
          )}
          <Field label="Category">
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">All categories</option>
              {categories
                .filter((c) => (fixedKind ? c.kind === fixedKind : true))
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} ({category.kind})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Account">
            <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description or name" />
          </Field>
          <Field label="Sort">
            <Select value={sort} onChange={(event) => setSort(event.target.value)}>
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHeader title="Transactions" subtitle={`${rows.length} record${rows.length === 1 ? '' : 's'} in this view`} />
        {loading ? (
          <Loading />
        ) : rows.length ? (
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            }
          >
            {rows.map((txn) => (
              <tr key={txn.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDate(txn.txn_date)}</td>
                <td className="px-4 py-2.5">
                  <Badge
                    tone={
                      txn.kind === 'income'
                        ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
                        : txn.kind === 'expense'
                          ? 'bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400'
                          : 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300'
                    }
                  >
                    {txn.kind === 'transfer' ? 'Transfer' : txn.kind === 'income' ? 'Income' : 'Expense'}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {txn.category_name ?? (txn.kind === 'transfer' ? 'Internal transfer' : 'Uncategorised')}
                  </p>
                  {txn.description ? <p className="text-[11px] text-slate-400">{txn.description}</p> : null}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                  {txn.kind === 'transfer' ? `${txn.account_name} → ${txn.counter_account_name ?? '—'}` : txn.account_name}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{paymentLabel(txn.payment_method)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <span
                    className={
                      txn.kind === 'income'
                        ? 'font-medium tabular-nums text-emerald-600 dark:text-emerald-400'
                        : txn.kind === 'expense'
                          ? 'font-medium tabular-nums text-rose-600 dark:text-rose-400'
                          : 'font-medium tabular-nums text-slate-600 dark:text-slate-300'
                    }
                  >
                    {txn.kind === 'expense' ? '−' : txn.kind === 'income' ? '+' : ''}
                    {money(txn.amount, txn.currency)}
                  </span>
                  {txn.currency !== baseCurrency ? <p className="text-[11px] text-slate-400">≈ {money(txn.base_amount, baseCurrency)}</p> : null}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  {txn.kind === 'transfer' ? (
                    <span className="text-[11px] text-slate-400">—</span>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(txn)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 dark:text-rose-400" onClick={() => setDeleting(txn)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        ) : (
          <EmptyState
            title="No transactions in this view"
            message="Adjust the filters or record a new movement."
            action={<Button size="sm" onClick={openCreate}>Add transaction</Button>}
          />
        )}
      </Card>

      {daily.length ? (
        <Card className="mt-4">
          <CardHeader title="Daily totals" subtitle="Income, expenses and net result per day" />
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Income</th>
                <th className="px-4 py-2 text-right font-medium">Expenses</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
              </tr>
            }
          >
            {daily
              .slice()
              .reverse()
              .map((day) => (
                <tr key={day.date}>
                  <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(day.date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(day.income, baseCurrency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{money(day.expense, baseCurrency)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">{money(day.net, baseCurrency)}</td>
                </tr>
              ))}
          </TableShell>
        </Card>
      ) : null}

      <Modal
        open={formOpen}
        title={editing ? 'Edit transaction' : fixedKind === 'income' ? 'Add income' : fixedKind === 'expense' ? 'Add expense' : 'Add transaction'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'Record'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          {fixedKind ? null : (
            <Field label="Type">
              <Select value={form.kind} onChange={(event) => setForm((prev) => ({ ...prev, kind: event.target.value as 'income' | 'expense', categoryId: '' }))}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date">
              <Input type="date" required value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
            </Field>
            <Field label="Amount" hint="Stored exactly, never rounded through floats">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={form.amount}
                onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
                placeholder="0.00"
              />
            </Field>
            <Field label="Currency">
              <Select
                value={form.currency}
                onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))}
              >
                <option value="UZS">UZS — Uzbekistani Som</option>
                <option value="USD">USD — US Dollar</option>
              </Select>
            </Field>
            <Field label="Account">
              <Select
                required
                value={form.accountId}
                onChange={(event) => {
                  const account = accounts.find((a) => a.id === event.target.value);
                  setForm((prev) => ({ ...prev, accountId: event.target.value, currency: account?.currency ?? prev.currency }));
                }}
              >
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={form.categoryId} onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}>
                <option value="">Uncategorised</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment method">
              <Select value={form.paymentMethod} onChange={(event) => setForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="mobile">Mobile payment</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>
          {needsRate ? (
            <Field label={`Exchange rate ${form.currency} → ${selectedAccount?.currency}`} hint="Required because the amount currency differs from the account currency.">
              <Input type="number" step="0.000001" min="0.000001" value={form.rateToAccount} onChange={(event) => setForm((prev) => ({ ...prev, rateToAccount: event.target.value }))} />
            </Field>
          ) : null}
          <Field label="Description">
            <Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="What was this for?" />
          </Field>
        </form>
      </Modal>

      <Modal
        open={transferOpen}
        title="Transfer between my accounts"
        onClose={() => setTransferOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTransferOpen(false)} disabled={transferBusy}>
              Cancel
            </Button>
            <Button onClick={submitTransfer} loading={transferBusy}>
              Transfer
            </Button>
          </>
        }
      >
        <form onSubmit={submitTransfer} className="space-y-3">
          {transferError ? <Alert tone="error">{transferError}</Alert> : null}
          <Alert tone="info">Transfers move money between your own accounts and are never counted as income or expenses.</Alert>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="From account">
              <Select required value={transfer.fromAccountId} onChange={(event) => setTransfer((prev) => ({ ...prev, fromAccountId: event.target.value }))}>
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To account">
              <Select required value={transfer.toAccountId} onChange={(event) => setTransfer((prev) => ({ ...prev, toAccountId: event.target.value }))}>
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount sent">
              <Input type="number" step="0.01" min="0.01" required value={transfer.amount} onChange={(event) => setTransfer((prev) => ({ ...prev, amount: event.target.value }))} />
            </Field>
            <Field label="Date">
              <Input type="date" required value={transfer.date} onChange={(event) => setTransfer((prev) => ({ ...prev, date: event.target.value }))} />
            </Field>
          </div>
          <Field label="Amount received (optional)" hint="Leave empty when both accounts share a currency.">
            <Input type="number" step="0.01" min="0" value={transfer.toAmount} onChange={(event) => setTransfer((prev) => ({ ...prev, toAmount: event.target.value }))} />
          </Field>
          <Field label="Description">
            <Input value={transfer.description} onChange={(event) => setTransfer((prev) => ({ ...prev, description: event.target.value }))} placeholder="e.g. Cash deposit to bank" />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this transaction?"
        message="The record will be removed and all balances and reports recalculated. This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busyDelete}
      />
    </>
  );
}
