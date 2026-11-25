import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from './AuthShell';
import { Alert, Button, Field, Input, errorMessage } from '../components/ui';
import { api } from '../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token.trim(), password);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 1400);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Paste your reset token or recovery code, then set a new password."
      footer={
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <Alert tone="success">Password updated. Redirecting you to the sign-in page…</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Reset token or recovery code">
            <Input required value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your token" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
