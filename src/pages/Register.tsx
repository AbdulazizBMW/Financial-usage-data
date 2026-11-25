import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from './AuthShell';
import { Alert, Button, Field, Input, Select, errorMessage } from '../components/ui';
import { useAuth } from '../context/Auth';

export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', baseCurrency: 'UZS' });
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const code = await signUp(form.name.trim(), form.email.trim(), form.password, form.baseCurrency);
      setRecoveryCode(code);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCode) {
    return (
      <AuthShell title="Account created" subtitle="Save your recovery code — it is the only way back in if you forget your password.">
        <div className="space-y-4">
          <Alert tone="warning">
            Store this code somewhere safe and offline. It will not be shown again, and email delivery may not be configured on this
            deployment.
          </Alert>
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-center font-mono text-lg tracking-[0.25em] text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            {recoveryCode}
          </div>
          <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
            Continue to dashboard
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your financial records stay private to this account."
      footer={
        <span>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="Full name">
          <Input required value={form.name} onChange={update('name')} placeholder="Your name" autoComplete="name" />
        </Field>
        <Field label="Email address">
          <Input type="email" required value={form.email} onChange={update('email')} placeholder="you@example.com" autoComplete="email" />
        </Field>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Password" hint="At least 8 characters">
            <Input type="password" required value={form.password} onChange={update('password')} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <Input type="password" required value={form.confirm} onChange={update('confirm')} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Base currency" hint="Used for consolidated reporting. Individual records keep their own currency.">
          <Select value={form.baseCurrency} onChange={update('baseCurrency')}>
            <option value="UZS">Uzbekistani Som (UZS)</option>
            <option value="USD">US Dollar (USD)</option>
          </Select>
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
