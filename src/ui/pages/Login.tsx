import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';

interface Props {
  onDone: () => void;
}

export function LoginPage({ onDone }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      onDone();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Sign in to Cotly</h1>
        <div className="field">
          <label className="label" htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="login-password">Password</label>
          <input id="login-password" className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="error-text" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
