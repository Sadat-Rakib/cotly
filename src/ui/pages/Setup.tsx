import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { TimezoneSelect } from '../components/TimezoneSelect';

interface Props {
  onDone: () => void;
}

export function SetupPage({ onDone }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/api/setup', { method: 'POST', body: { email, password, timezone: tz } });
      onDone(); // setup response sets the session cookie server-side
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Welcome to Cotly</h1>
        <p className="hint">Create the owner account. This screen permanently locks once setup is complete.</p>
        <div className="field">
          <label className="label" htmlFor="setup-email">Email</label>
          <input id="setup-email" className="input" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="setup-password">Password</label>
          <input id="setup-password" className="input" type="password" autoComplete="new-password" required minLength={8}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Timezone</span>
          <TimezoneSelect value={tz} onChange={setTz} />
        </div>
        {err && <p className="error-text" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
