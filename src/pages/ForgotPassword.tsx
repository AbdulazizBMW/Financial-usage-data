import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from './AuthShell';
import { Alert, Button, Field, Input, errorMessage } from '../components/ui';
import { api } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ message: string; resetLink?: string; mailConfigured: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await api.forgotPassword(email.trim());
      setResult(response);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will issue a single-use reset link for your account."
      footer={
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Back to sign in
        </Link>
      }
    >
      {result ? (
        <div className="space-y-3">
          <Alert tone="info">{result.message}</Alert>
          {result.resetLink ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Email delivery is not configured on this deployment, so use this one-time link directly:
              </p>
              <a
                href={result.resetLink}
                className="block break-all text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {result.resetLink}
              </a>
            </div>
          ) : null}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            If you saved a recovery code when you registered, you can also use it on the{' '}
            <Link to="/reset-password" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              reset page
            </Link>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Email address">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
