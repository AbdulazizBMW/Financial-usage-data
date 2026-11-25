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
  errorMessage,
  useToast
} from '../components/ui';
import { api, type Category } from '../lib/api';

export default function Categories() {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<{ name: string; kind: 'income' | 'expense' }>({ name: '', kind: 'expense' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.categories();
      setCategories(result.categories);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(
    () => ({
      income: categories.filter((category) => category.kind === 'income'),
      expense: categories.filter((category) => category.kind === 'expense')
    }),
    [categories]
  );

  const openCreate = (kind: 'income' | 'expense') => {
    setEditing(null);
    setForm({ name: '', kind });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditing(category);
    setForm({ name: category.name, kind: category.kind });
    setFormError('');
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Enter a category name.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateCategory(editing.id, { name: form.name.trim() });
        toast.push('Category renamed.');
      } else {
        await api.createCategory({ name: form.name.trim(), kind: form.kind });
        toast.push('Category created.');
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
      await api.deleteCategory(deleting.id);
      toast.push('Category deleted.');
      setDeleting(null);
      await load();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setBusyDelete(false);
    }
  };

  const renderList = (kind: 'income' | 'expense') => {
    const items = grouped[kind];
    const accent = kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    return (
      <Card>
        <CardHeader
          title={kind === 'income' ? 'Income categories' : 'Expense categories'}
          subtitle={`${items.length} ${items.length === 1 ? 'category' : 'categories'}`}
          action={
            <Button size="sm" variant="secondary" onClick={() => openCreate(kind)}>
              Add
            </Button>
          }
        />
        {loading ? (
          <Loading />
        ) : items.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{category.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {category.usageCount ? `${category.usageCount} transactions` : 'Not used yet'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(category)}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" className={accent} onClick={() => setDeleting(category)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No categories"
            message="Add a category so transactions can be grouped in reports."
            action={
              <Button size="sm" onClick={() => openCreate(kind)}>
                Add category
              </Button>
            }
          />
        )}
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="Categories" subtitle="Group income and expenses for breakdowns, analytics and reports.">
        <Button onClick={() => openCreate('expense')}>New category</Button>
      </PageHeader>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400">
          {grouped.income.length} income
        </Badge>
        <Badge tone="bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400">{grouped.expense.length} expense</Badge>
        <Badge>{categories.length} total</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {renderList('income')}
        {renderList('expense')}
      </div>

      <Modal
        open={formOpen}
        title={editing ? 'Rename category' : 'New category'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              {editing ? 'Save' : 'Create category'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <Field label="Category name">
            <Input
              required
              autoFocus
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={form.kind === 'income' ? 'e.g. Consulting' : 'e.g. Groceries'}
            />
          </Field>
          {!editing ? (
            <Field label="Type" hint="A category belongs to either income or expenses.">
              <Select value={form.kind} onChange={(event) => setForm((prev) => ({ ...prev, kind: event.target.value as 'income' | 'expense' }))}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
            </Field>
          ) : (
            <p className="text-[11px] text-slate-400">
              Existing transactions keep this category. Type cannot be changed after creation.
            </p>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this category?"
        message="Transactions that already use this category must be reassigned first — the server will refuse the deletion otherwise."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busyDelete}
      />
    </>
  );
}
