import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { AuthShell, inputClass } from './Login';

interface Props {
  onDone: () => void;
  onNav: (p: string) => void;
}

export function SignupPage({ onDone, onNav }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: { name, email, password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
      });
      onDone();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 className="text-white text-2xl font-medium tracking-tight text-center mt-6">Create your Cotly account.</h1>
      <p className="text-white/45 text-sm text-center mt-1.5">One place to write, schedule, and move on.</p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <label className="block">
          <span className="text-xs text-white/50">Name</span>
          <input
            className={`${inputClass} mt-1.5`}
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-white/50">Email</span>
          <input
            className={`${inputClass} mt-1.5`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-white/50">Password</span>
          <input
            className={`${inputClass} mt-1.5`}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="text-xs text-white/35 mt-1 block">At least 8 characters.</span>
        </label>

        {err && (
          <p className="text-sm text-red-300" role="alert">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 w-full rounded-lg bg-white text-black text-sm font-semibold py-2.5 hover:bg-white/90 disabled:opacity-60"
        >
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-sm text-white/45 text-center mt-6">
        Existing user?{' '}
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            onNav('/login');
          }}
          className="text-white underline-offset-4 hover:underline"
        >
          Sign in
        </a>
      </p>
    </AuthShell>
  );
}
