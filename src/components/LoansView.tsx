import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
} from '../components/ui';
import { api, type Account, type Loan, type LoanPayment } from '../lib/api';
import { compact, formatDate, money, relativeDays, statusLabel, statusTone, todayISO } from '../lib/format';
import { useAuth } from '../context/Auth';

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'partially_repaid', label: 'Partially repaid' },
  { value: 'fully_repaid', label: 'Fully repaid' },
  { value: 'overdue', label: 'Overdue' }
];

export default function LoansView({ direction }: { direction: 'lend' | 'borrow' }) {
  const { baseCurrency } = useAuth();
  const toast = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState({
    counterparty: '',
    amount: '',
    currency: baseCurrency,
    accountId: '',
    date: todayISO(),
    dueDate: '',
    description: '',
    notes: ''
  });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [paymentLoan, setPaymentLoan] = useState<Loan | null>(null);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [payment, setPayment] = useState({ date: todayISO(), amount: '', currency: baseCurrency, accountId: '', note: '' });
  const [paymentError, setPaymentError] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);

  const [deleting, setDeleting] = useState<Loan | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, accs] = await Promise.all([
        api.loans(direction, { status: status || undefined, search: search.trim() || undefined }),
        api.accounts()
      ]);
      setLoans(list.loans);
      setTotals((list.totals ?? {}) as Record<string, string>);
      setAccounts(accs.accounts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [direction, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const counterpartyLabel = direction === 'lend' ? 'Borrower' : 'Lender';

  const chartData = useMemo(
    () =>
      loans.slice(0, 10).map((loan) => ({
        name: loan.counterparty.length > 14 ? `${loan.counterparty.slice(0, 13)}…` : loan.counterparty,
        Outstanding: Number(loan.outstanding_base),
        Repaid: Number(loan.repaid_base)
      })),
    [loans]
  );

  const openCreate = () => {
    const account = accounts[0];
    setEditing(null);
    setForm({
      counterparty: '',
      amount: '',
      currency: account?.currency ?? baseCurrency,
      accountId: account?.id ?? '',
      date: todayISO(),
      dueDate: '',
      description: '',
      notes: ''
    });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (loan: Loan) => {
    setEditing(loan);
    setForm({
      counterparty: loan.counterparty,
      amount: String(Number(loan.amount)),
      currency: loan.currency,
      accountId: loan.account_id,
      date: loan.loan_date,
      dueDate: loan.due_date ?? '',
      description: loan.description ?? '',
      notes: loan.notes ?? ''
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = { ...form, direction, dueDate: form.dueDate || null };
      if (editing) {
        await api.updateLoan(editing.id, payload);
        toast.push('Record updated.');
      } else {
        await api.createLoan(payload);
        toast.push(direction === 'lend' ? 'Loan recorded.' : 'Borrowing recorded.');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openPayment = async (loan: Loan) => {
    setPaymentLoan(loan);
    setPayment({ date: todayISO(), amount: String(Number(loan.outstanding)), currency: loan.currency, accountId: loan.account_id, note: '' });
    setPaymentError('');
    try {
      const detail = await api.loan(loan.id);
      setPayments(detail.payments ?? []);
    } catch {
      setPayments([]);
    }
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentLoan) return;
    setPaymentError('');
    setPaymentBusy(true);
    try {
      await api.addPayment(paymentLoan.id, payment);
      toast.push('Repayment recorded.');
      const detail = await api.loan(paymentLoan.id);
      setPayments(detail.payments ?? []);
      setPayment({ date: todayISO(), amount: '', currency: paymentLoan.currency, accountId: paymentLoan.account_id, note: '' });
      await load();
    } catch (err) {
      setPaymentError(errorMessage(err));
    } finally {
      setPaymentBusy(false);
    }
  };

  const removePayment = async (paymentId: string) => {
    if (!paymentLoan) return;
    try {
      await api.deletePayment(paymentLoan.id, paymentId);
      toast.push('Repayment removed.');
      const detail = await api.loan(paymentLoan.id);
      setPayments(detail.payments ?? []);
      await load();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await api.deleteLoan(deleting.id);
      toast.push('Record deleted.');
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
      <PageHeader
        title={direction === 'lend' ? 'Lending' : 'Borrowing'}
        subtitle={
          direction === 'lend'
            ? 'Money you gave to others. Lending reduces your cash but is never an expense.'
            : 'Money you received from others. Borrowing increases your cash but is never income.'
        }
      >
        <Button onClick={openCreate}>{direction === 'lend' ? 'Record a loan' : 'Record a borrowing'}</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={direction === 'lend' ? 'Total lent' : 'Total borrowed'} value={money(totals.total ?? 0, baseCurrency)} hint="Original amounts" />
        <StatCard
          label={direction === 'lend' ? 'Outstanding receivables' : 'Outstanding payables'}
          value={money(totals.outstanding ?? 0, baseCurrency)}
          tone="warning"
          hint="Still owed"
        />
        <StatCard label={direction === 'lend' ? 'Repaid to you' : 'Repaid by you'} value={money(totals.repaid ?? 0, baseCurrency)} tone="positive" />
        <StatCard label="Active records" value={String(loans.filter((loan) => loan.status !== 'fully_repaid').length)} hint={`${loans.length} total`} />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`${counterpartyLabel} name`} />
          </Field>
        </div>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <CardHeader title={direction === 'lend' ? 'Loans given' : 'Money borrowed'} subtitle={`${loans.length} record${loans.length === 1 ? '' : 's'}`} />
        {loading ? (
          <Loading />
        ) : loans.length ? (
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 font-medium">{counterpartyLabel}</th>
                <th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 text-right font-medium">Original</th>
                <th className="px-4 py-2 text-right font-medium">Repaid</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            }
          >
            {loans.map((loan) => (
              <tr key={loan.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{loan.counterparty}</p>
                  <p className="text-[11px] text-slate-400">
                    {loan.account_name}
                    {loan.description ? ` · ${loan.description}` : ''}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                  <p>{formatDate(loan.loan_date)}</p>
                  <p className="text-[11px] text-slate-400">{loan.due_date ? `${formatDate(loan.due_date)} · ${relativeDays(loan.due_date)}` : 'No due date'}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(loan.amount, loan.currency)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(loan.repaid, loan.currency)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                  {money(loan.outstanding, loan.currency)}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={statusTone(loan.status)}>{statusLabel(loan.status)}</Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {loan.status !== 'fully_repaid' ? (
                      <Button size="sm" variant="success" onClick={() => void openPayment(loan)}>
                        Repay
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void openPayment(loan)}>
                        History
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(loan)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => setDeleting(loan)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        ) : (
          <EmptyState
            title={direction === 'lend' ? 'No loans recorded' : 'No borrowings recorded'}
            message="Record money you have given or received to track what is still outstanding."
            action={<Button size="sm" onClick={openCreate}>Add record</Button>}
          />
        )}
      </Card>

      {chartData.length ? (
        <Card className="mt-4">
          <CardHeader title="Outstanding vs repaid" subtitle="Consolidated in your base currency" />
          <div className="h-64 px-2 py-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.18)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-12} height={44} />
                <YAxis tickFormatter={(value) => compact(value)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(value: number) => money(value, baseCurrency)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Outstanding" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Repaid" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      <Modal
        open={formOpen}
        title={editing ? 'Edit record' : direction === 'lend' ? 'Record money lent' : 'Record money borrowed'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'Save'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={`${counterpartyLabel}'s full name`}>
              <Input required value={form.counterparty} onChange={(event) => setForm((prev) => ({ ...prev, counterparty: event.target.value }))} />
            </Field>
            <Field label="Amount">
              <Input type="number" step="0.01" min="0.01" required value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} />
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))}>
                <option value="UZS">UZS</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label={direction === 'lend' ? 'Account money left from' : 'Account money arrived in'}>
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
            <Field label="Date">
              <Input type="date" required value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
            </Field>
            <Field label="Expected repayment date">
              <Input type="date" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </Field>
          </div>
          <Field label="Description">
            <Input value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Purpose of the money" />
          </Field>
          <Field label="Notes">
            <Textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </Field>
        </form>
      </Modal>

      <Modal open={Boolean(paymentLoan)} title="Repayments" onClose={() => setPaymentLoan(null)} wide>
        {paymentLoan ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Original</p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{money(paymentLoan.amount, paymentLoan.currency)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Repaid</p>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{money(paymentLoan.repaid, paymentLoan.currency)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Outstanding</p>
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{money(paymentLoan.outstanding, paymentLoan.currency)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Status</p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{statusLabel(paymentLoan.status)}</p>
              </div>
            </div>

            {paymentLoan.status !== 'fully_repaid' ? (
              <form onSubmit={submitPayment} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                {paymentError ? <Alert tone="error">{paymentError}</Alert> : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Repayment date">
                    <Input type="date" required value={payment.date} onChange={(event) => setPayment((prev) => ({ ...prev, date: event.target.value }))} />
                  </Field>
                  <Field label="Amount received" hint={`Outstanding ${money(paymentLoan.outstanding, paymentLoan.currency)}`}>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={payment.amount}
                      onChange={(event) => setPayment((prev) => ({ ...prev, amount: event.target.value }))}
                    />
                  </Field>
                  <Field label="Account">
                    <Select required value={payment.accountId} onChange={(event) => setPayment((prev) => ({ ...prev, accountId: event.target.value }))}>
                      <option value="">Select account</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.currency})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Note">
                    <Input value={payment.note} onChange={(event) => setPayment((prev) => ({ ...prev, note: event.target.value }))} placeholder="Optional" />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPayment((prev) => ({ ...prev, amount: String(Number(paymentLoan.outstanding)) }))}
                  >
                    Full outstanding
                  </Button>
                  <Button type="submit" size="sm" loading={paymentBusy}>
                    Record repayment
                  </Button>
                </div>
              </form>
            ) : (
              <Alert tone="success">This record is fully repaid. Outstanding balance is zero.</Alert>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Repayment history</p>
              {payments.length ? (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {payments.map((row) => (
                    <div key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-100">{money(row.amount, row.currency)}</p>
                        <p className="text-[11px] text-slate-400">
                          {formatDate(row.pay_date)}
                          {row.note ? ` · ${row.note}` : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => void removePayment(row.id)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No repayments recorded yet.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this record?"
        message="The record and its repayment history will be removed, and your balances recalculated."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busyDelete}
      />
    </>
  );
}
