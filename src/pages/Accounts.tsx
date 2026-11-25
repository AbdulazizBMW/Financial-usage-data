import { useCallback, useEffect, useState } from 'react';
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
  errorMessage,
  useToast
} from '../components/ui';
import { api, type Account } from '../lib/api';
import { accountTypeLabel, formatDate, money, todayISO } from '../lib/format';
import { useAuth } from '../context/Auth';

export default function Accounts() {
  const { baseCurrency } = useAuth();
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totalBase, setTotalBase] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState({ name: '', type: 'cash', currency: baseCurrency, openingBalance: '0', openingDate: todayISO() });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<{ account: Account; movements: { id: string; date: string; description: string; kind: string; amount: string; currency: string; running: string }[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.accounts();
      setAccounts(result.accounts);
      setTotalBase(result.totalBase);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'cash', currency: baseCurrency, openingBalance: '0', openingDate: todayISO() });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setForm({
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalance: String(Number(account.opening_balance ?? account.openingBalance ?? 0)),
      openingDate: account.opening_date ?? todayISO()
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editing) {
        await api.updateAccount(editing.id, form);
        toast.push('Account updated.');
      } else {
        await api.createAccount(form);
        toast.push('Account created.');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (account: Account) => {
    setHistoryLoading(true);
    try {
      const result = await api.movements(account.id);
      setHistory(result);
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await api.deleteAccount(deleting.id);
      toast.push('Account deleted.');
      setDeleting(null);
      await load();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <>
      <PageHeader title="Accounts" subtitle="Cash, cards and bank accounts. Balances update automatically from every movement.">
        <Button onClick={openCreate}>New account</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Consolidated balance" value={money(totalBase, baseCurrency)} hint="All accounts converted to base currency" />
        <StatCard label="Accounts" value={String(accounts.length)} />
        <StatCard label="Currencies" value={Array.from(new Set(accounts.map((a) => a.currency))).join(', ') || '—'} />
        <StatCard label="Archived" value={String(accounts.filter((a) => a.archived).length)} hint="Hidden from new records" />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHeader title="Your accounts" subtitle="Current balance includes opening balance and all cash movements" />
        {loading ? (
          <Loading />
        ) : accounts.length ? (
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Opening</th>
                <th className="px-4 py-2 text-right font-medium">Balance</th>
                <th className="px-4 py-2 text-right font-medium">In base</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            }
          >
            {accounts.map((account) => (
              <tr key={account.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{account.name}</p>
                  <p className="text-[11px] text-slate-400">{account.archived ? 'Archived' : `Opened ${formatDate(account.opening_date)}`}</p>
                </td>
                <td className="px-4 py-2.5">
                  <Badge>{accountTypeLabel(account.type)}</Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">
                  {money(account.opening_balance ?? account.openingBalance ?? 0, account.currency)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                  {money(account.balance, account.currency)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{money(account.baseBalance, baseCurrency)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => void openHistory(account)}>
                      History
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(account)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => setDeleting(account)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        ) : (
          <EmptyState
            title="No accounts yet"
            message="Create your first cash or bank account so transactions have somewhere to live."
            action={<Button size="sm" onClick={openCreate}>New account</Button>}
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Edit account' : 'New account'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'Create account'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <Field label="Account name">
            <Input required value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="e.g. Cash, Kapitalbank card" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}>
                <option value="cash">Cash</option>
                <option value="card">Bank card</option>
                <option value="bank">Bank account</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))}>
                <option value="UZS">UZS</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label="Opening balance">
              <Input type="number" step="0.01" value={form.openingBalance} onChange={(event) => setForm((prev) => ({ ...prev, openingBalance: event.target.value }))} />
            </Field>
            <Field label="Opening date">
              <Input type="date" value={form.openingDate} onChange={(event) => setForm((prev) => ({ ...prev, openingDate: event.target.value }))} />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(history)} title={history ? `${history.account.name} — movements` : 'Movements'} onClose={() => setHistory(null)} wide>
        {historyLoading ? <Loading /> : null}
        {history ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Opening balance</p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {money(history.account.opening_balance ?? history.account.openingBalance ?? 0, history.account.currency)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Current balance</p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{money(history.account.balance, history.account.currency)}</p>
              </div>
            </div>
            {history.movements.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {history.movements.map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-100">{row.description}</p>
                      <p className="text-[11px] text-slate-400">
                        {formatDate(row.date)} · {row.kind}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums text-slate-700 dark:text-slate-200">{money(row.amount, row.currency)}</p>
                      <p className="text-[11px] text-slate-400">balance {money(row.running, row.currency)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No movements recorded on this account yet.</p>
            )}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this account?"
        message="Accounts that already hold transactions cannot be deleted — archive them instead by editing the account."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busyDelete}
      />
    </>
  );
}
