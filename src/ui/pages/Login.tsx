import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Logo } from '../components/Logo';

interface Props {
  onDone: () => void;
  onNav: (p: string) => void;
}

// Shared dark auth shell so login and signup visually match the landing page.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] bg-black flex items-center justify-center px-6 py-16">
      {/* Back to the landing page — /login is often opened directly. */}
      <a
        href="/"
        aria-label="Back to Cotly"
        className="absolute top-5 left-5 md:top-8 md:left-8 inline-flex items-center gap-2 no-underline text-white/70 hover:text-white text-sm rounded-lg px-3 py-2 border border-white/15 bg-white/[0.04] hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Cotly
      </a>
      <div className="relative w-full max-w-[420px] rounded-2xl border border-[hsl(0_0%_20%)] bg-[hsl(0_0%_5%)] p-8">
        <div className="flex items-center justify-center text-white">
          <Logo markClass="w-5 h-5" wordClass="text-lg font-semibold tracking-tight" />
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-white/15 bg-[hsl(0_0%_8%)] px-3 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/50 focus:ring-2 focus:ring-white/25';

// Password field with a keyboard-accessible show/hide control (Eye when hidden,
// EyeOff when visible). The button never submits the form.
export function PasswordField({
  value,
  onChange,
  autoComplete = 'current-password',
  label = 'Password',
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  label?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="text-xs text-white/60">{label}</span>
      <div className="relative mt-1.5">
        <input
          className={`${inputClass} pr-12`}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-white/60 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </label>
  );
}

export function LoginPage({ onDone, onNav }: Props) {
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
      <p className="text-white/50 text-sm text-center mt-1.5">
        Post once. Get on with your <span className="font-instrument italic">day.</span>
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <label className="block">
          <span className="text-xs text-white/60">Email</span>
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
          <PasswordField value={password} onChange={setPassword} />
        </div>

        {err && (
          <p className="text-sm text-red-300" role="alert">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 w-full rounded-lg bg-white text-black text-sm font-semibold py-2.5 hover:bg-white/90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-white/50 text-center mt-6">
        New to Cotly?{' '}
        <a
          href="/signup"
          onClick={(e) => {
            e.preventDefault();
            onNav('/signup');
          }}
          className="text-white underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded"
        >
          Create account
        </a>
      </p>
    </AuthShell>
  );
}
