import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { Flower2 } from 'lucide-react';

interface Props {
  onDone: () => void;
  onNav: (p: string) => void;
}

// Shared dark auth shell so login and signup visually match the landing page.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px] rounded-2xl border border-[hsl(0_0%_20%)] bg-[hsl(0_0%_5%)] p-8">
        <div className="flex items-center justify-center gap-2 text-white">
          <Flower2 className="w-5 h-5 text-white/90" />
          <span className="text-lg font-semibold tracking-tight">cotly</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-white/10 bg-[hsl(0_0%_8%)] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30';

export function LoginPage({ onDone, onNav }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
    <AuthShell>
      <h1 className="text-white text-2xl font-medium tracking-tight text-center mt-6">Welcome back.</h1>
      <p className="text-white/45 text-sm text-center mt-1.5">
        Post once. Get on with your <span className="font-instrument italic">day.</span>
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
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
          <div className="relative mt-1.5">
            <input
              className={`${inputClass} pr-16`}
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/50 hover:text-white px-2 py-1"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
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
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-white/45 text-center mt-6">
        New to Cotly?{' '}
        <a
          href="/signup"
          onClick={(e) => {
            e.preventDefault();
            onNav('/signup');
          }}
          className="text-white underline-offset-4 hover:underline"
        >
          Create account
        </a>
      </p>
    </AuthShell>
  );
}
