import { useCallback, useEffect, useRef, useState } from 'react';
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
  PageHeader,
  Select,
  TableShell,
  errorMessage,
  useToast
} from '../components/ui';
import { api, downloadUrl, type BackupMeta, type Meta } from '../lib/api';
import { formatDate, formatDateTime, money } from '../lib/format';
import { useAuth } from '../context/Auth';

type FxState = {
  baseCurrency: string;
  latest: Record<string, string>;
  history: { currency: string; rate: string; as_of: string }[];
};

export default function Settings() {
  const { user, setUser, baseCurrency, refresh } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState({ name: user?.name ?? '', baseCurrency });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordDone, setPasswordDone] = useState(false);

  const [fx, setFx] = useState<FxState | null>(null);
  const [fxForm, setFxForm] = useState({ currency: 'USD', rate: '', asOf: '' });
  const [fxSaving, setFxSaving] = useState(false);
  const [fxError, setFxError] = useState('');

  const [meta, setMeta] = useState<Meta | null>(null);
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [retention, setRetention] = useState<{ automatic: string; manual: string } | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupError, setBackupError] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupMeta | 'upload' | null>(null);
  const [restoreFile, setRestoreFile] = useState<unknown>(null);
  const [restoreName, setRestoreName] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [audit, setAudit] = useState<{ id: string; entity: string; action: string; detail: Record<string, unknown>; created_at: string }[]>([]);

  const loadFx = useCallback(async () => {
    try {
      const result = await api.fxRates();
      setFx(result);
    } catch (err) {
      setFxError(errorMessage(err));
    }
  }, []);

  const loadBackups = useCallback(async () => {
    setBackupLoading(true);
    setBackupError('');
    try {
      const result = await api.backups();
      setBackups(result.backups);
      setRetention(result.retention);
      setLastBackupAt(result.lastBackupAt);
    } catch (err) {
      setBackupError(errorMessage(err));
    } finally {
      setBackupLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFx();
    void loadBackups();
    api
      .meta()
      .then(setMeta)
      .catch(() => undefined);
    api
      .audit()
      .then((result) => setAudit(result.entries))
      .catch(() => undefined);
  }, [loadFx, loadBackups]);

  useEffect(() => {
    setProfile({ name: user?.name ?? '', baseCurrency });
  }, [user?.name, baseCurrency]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError('');
    setProfileSaved(false);
    setProfileSaving(true);
    try {
      const result = await api.settings({ name: profile.name.trim(), baseCurrency: profile.baseCurrency });
      setUser(result.user);
      setProfileSaved(true);
      toast.push('Profile updated.');
      await loadFx();
      await refresh();
    } catch (err) {
      setProfileError(errorMessage(err));
    } finally {
      setProfileSaving(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordDone(false);
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    if (passwordForm.newPassword.length < 10) {
      setPasswordError('Use at least 10 characters.');
      return;
    }
    setPasswordSaving(true);
    try {
      await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
      setPasswordDone(true);
      toast.push('Password changed.');
    } catch (err) {
      setPasswordError(errorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  };

  const saveFx = async (event: React.FormEvent) => {
    event.preventDefault();
    setFxError('');
    setFxSaving(true);
    try {
      await api.saveFxRate({
        currency: fxForm.currency,
        rate: fxForm.rate,
        asOf: fxForm.asOf || undefined
      });
      setFxForm({ currency: 'USD', rate: '', asOf: '' });
      toast.push('Exchange rate saved.');
      await loadFx();
    } catch (err) {
      setFxError(errorMessage(err));
    } finally {
      setFxSaving(false);
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      await api.createBackup();
      toast.push('Backup created.');
      await loadBackups();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const deleteBackup = async (backup: BackupMeta) => {
    setBackupBusy(true);
    try {
      await api.deleteBackup(backup.id);
      toast.push('Backup deleted.');
      await loadBackups();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const pickFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      setRestoreFile(parsed);
      setRestoreName(file.name);
      setRestoreTarget('upload');
    } catch {
      toast.push('That file is not valid backup JSON.', 'error');
    }
  };

  const runRestore = async () => {
    setRestoreBusy(true);
    try {
      if (restoreTarget === 'upload') {
        await api.restoreBackup({ payload: restoreFile });
      } else if (restoreTarget) {
        await api.restoreBackup({ backupId: restoreTarget.id });
      }
      toast.push('Data restored from backup.');
      setRestoreTarget(null);
      setRestoreFile(null);
      setRestoreName('');
      await loadBackups();
      await refresh();
    } catch (err) {
      toast.push(errorMessage(err), 'error');
    } finally {
      setRestoreBusy(false);
    }
  };

  const storage = meta?.storage;

  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, security, exchange rates and data protection." />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profile" subtitle="Your name appears on exported reports." />
          <form onSubmit={saveProfile} className="space-y-3 p-4">
            {profileError ? <Alert tone="error">{profileError}</Alert> : null}
            {profileSaved ? <Alert tone="success">Profile saved.</Alert> : null}
            <Field label="Full name">
              <Input value={profile.name} onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))} required />
            </Field>
            <Field label="Email" hint="Your sign-in address cannot be changed here.">
              <Input value={user?.email ?? ''} disabled />
            </Field>
            <Field label="Base currency" hint="Consolidated totals and reports use this currency.">
              <Select value={profile.baseCurrency} onChange={(event) => setProfile((prev) => ({ ...prev, baseCurrency: event.target.value }))}>
                <option value="UZS">UZS — Uzbekistani som</option>
                <option value="USD">USD — US dollar</option>
              </Select>
            </Field>
            <Button type="submit" loading={profileSaving}>
              Save profile
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Change password" subtitle="Sessions stay signed in only for this browser." />
          <form onSubmit={savePassword} className="space-y-3 p-4">
            {passwordError ? <Alert tone="error">{passwordError}</Alert> : null}
            {passwordDone ? <Alert tone="success">Password updated. Use it the next time you sign in.</Alert> : null}
            <Field label="Current password">
              <Input
                type="password"
                required
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
              />
            </Field>
            <Field label="New password" hint="At least 10 characters.">
              <Input
                type="password"
                required
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              />
            </Field>
            <Field label="Repeat new password">
              <Input
                type="password"
                required
                value={passwordForm.confirm}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirm: event.target.value }))}
              />
            </Field>
            <Button type="submit" loading={passwordSaving}>
              Update password
            </Button>
          </form>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Exchange rates"
            subtitle={`Base currency: ${fx?.baseCurrency ?? baseCurrency}. Past reports keep the rate recorded with each transaction.`}
          />
          <form onSubmit={saveFx} className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4 dark:border-slate-800">
            {fxError ? (
              <div className="sm:col-span-4">
                <Alert tone="error">{fxError}</Alert>
              </div>
            ) : null}
            <Field label="Currency">
              <Select value={fxForm.currency} onChange={(event) => setFxForm((prev) => ({ ...prev, currency: event.target.value }))}>
                <option value="USD">USD</option>
                <option value="UZS">UZS</option>
              </Select>
            </Field>
            <Field label={`Rate (${fxForm.currency} → ${baseCurrency})`}>
              <Input type="number" step="0.0001" min="0" required value={fxForm.rate} onChange={(event) => setFxForm((prev) => ({ ...prev, rate: event.target.value }))} />
            </Field>
            <Field label="Effective date" hint="Defaults to today.">
              <Input type="date" value={fxForm.asOf} onChange={(event) => setFxForm((prev) => ({ ...prev, asOf: event.target.value }))} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" loading={fxSaving} className="w-full">
                Save rate
              </Button>
            </div>
          </form>
          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {fx && Object.entries(fx.latest).length ? (
                Object.entries(fx.latest).map(([currency, rate]) => (
                  <Badge key={currency} tone="bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:text-brand-300">
                    1 {currency} = {money(rate, baseCurrency)}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-slate-400">No rates recorded yet.</span>
              )}
            </div>
            {fx?.history?.length ? (
              <TableShell
                head={
                  <tr>
                    <th className="px-4 py-2 font-medium">Currency</th>
                    <th className="px-4 py-2 text-right font-medium">Rate</th>
                    <th className="px-4 py-2 text-right font-medium">Effective</th>
                  </tr>
                }
              >
                {fx.history.slice(0, 8).map((row) => (
                  <tr key={`${row.currency}-${row.as_of}`}>
                    <td className="px-4 py-2">{row.currency}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(row.rate, baseCurrency)}</td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500 dark:text-slate-400">{formatDate(row.as_of)}</td>
                  </tr>
                ))}
              </TableShell>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Backups"
            subtitle="Download a full copy of your records, or restore one if something goes wrong."
            action={
              <Button size="sm" onClick={createBackup} loading={backupBusy}>
                Create backup
              </Button>
            }
          />
          <div className="space-y-2 border-b border-slate-100 p-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <p>
              {lastBackupAt ? `Last backup: ${formatDateTime(lastBackupAt)}` : 'No backup has been created yet.'}
            </p>
            {retention ? (
              <p>
                Retention — automatic: {retention.automatic}; manual: {retention.manual}. Automatic snapshots are taken every few hours
                while you use the app, so a recent version is always available.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void pickFile(event.target.files?.[0] ?? null)} />
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                Restore from file
              </Button>
              <span className="text-[11px]">Restoring replaces your current records with the backup contents.</span>
            </div>
          </div>
          {backupError ? <Alert tone="error">{backupError}</Alert> : null}
          {backupLoading ? (
            <Loading />
          ) : backups.length ? (
            <TableShell
              head={
                <tr>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              }
            >
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{formatDateTime(backup.createdAt)}</td>
                  <td className="px-4 py-2">
                    <Badge>{backup.kind}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{backup.sizeKb} KB</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <a href={downloadUrl.backup(backup.id)} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost">
                          Download
                        </Button>
                      </a>
                      <Button size="sm" variant="ghost" onClick={() => setRestoreTarget(backup)}>
                        Restore
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => void deleteBackup(backup)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          ) : (
            <EmptyState title="No backups yet" message="Create your first backup, or wait for the automatic snapshot." />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Storage and durability" subtitle="Where your financial records live" />
          <div className="space-y-2 p-4 text-xs text-slate-600 dark:text-slate-300">
            <p>
              Database engine: <span className="font-medium">{storage?.engine ?? 'PostgreSQL'}</span>
              {storage?.durable ? ' — records are stored on the server, not in this browser.' : ''}
            </p>
            <p>Nothing important is kept only in browser storage. Clearing your browser does not remove any financial record.</p>
            <p>
              Backups are downloadable JSON files containing accounts, categories, transactions, lending, borrowing and exchange rates for
              your account only.
            </p>
            <p className="text-slate-400">
              Recovery: download a backup regularly, keep it somewhere safe, and use “Restore from file” here if you ever need to recover.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Activity log" subtitle="Recent changes to your records" />
          {audit.length ? (
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {audit.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {entry.action} · {entry.entity}
                    </p>
                    <p className="text-[11px] text-slate-400">{formatDateTime(entry.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No activity yet" message="Your record changes will be listed here." />
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="Restore this backup?"
        message={
          restoreTarget === 'upload'
            ? `Restoring ${restoreName || 'this file'} replaces your current accounts, transactions, loans and categories with the file contents.`
            : 'Restoring replaces your current accounts, transactions, loans and categories with the selected backup.'
        }
        confirmLabel="Restore data"
        onConfirm={runRestore}
        onCancel={() => {
          setRestoreTarget(null);
          setRestoreFile(null);
          setRestoreName('');
        }}
        busy={restoreBusy}
      />
    </>
  );
}
