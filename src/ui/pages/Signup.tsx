import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { AuthShell, PasswordField, inputClass } from './Login';

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
    if (busy) return;
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
      <h1 className="text-[#1e1b4b] font-instrument text-3xl text-center mt-6">Create your Cotly account.</h1>
      <p className="text-[#1e1b4b]/60 text-sm text-center mt-1.5">One place to write, schedule, and move on.</p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <label className="block">
          <span className="text-xs font-medium text-[#1e1b4b]/60">Name</span>
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
          <span className="text-xs font-medium text-[#1e1b4b]/60">Email</span>
          <input
            className={`${inputClass} mt-1.5`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="mt-0">
          <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />
          <span className="text-xs text-[#1e1b4b]/60 mt-1 block">At least 8 characters.</span>
        </div>

        {err && (
          <p className="text-sm text-red-700" role="alert">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 w-full rounded-lg bg-[#232671] text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-[#2d3090] shadow-lg shadow-[#232671]/30 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b6cf5]/60"
        >
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-sm text-[#1e1b4b]/75 text-center mt-6">
        Existing user?{' '}
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            onNav('/login');
          }}
          className="text-[#312e81] font-semibold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b6cf5]/60 rounded"
        >
          Sign in
        </a>
      </p>
    </AuthShell>
  );
}
