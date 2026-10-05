import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Logo } from '../components/Logo';

interface Props {
  onDone: () => void;
  onNav: (p: string) => void;
}

// Shared sky-glass auth shell so login and signup visually match the landing page.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] cotly-sky flex items-center justify-center px-6 py-16 overflow-hidden">
      {/* Decorative sky scene — same clouds/orbs as the landing hero. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="sky-cloud w-[380px] h-[170px] top-[8%] left-[6%] opacity-70" />
        <div className="sky-cloud w-[340px] h-[150px] top-[62%] right-[8%] opacity-60" />
        <div className="sky-orb w-12 h-12 top-[16%] right-[16%] sky-float" />
        <div className="sky-orb sky-orb-rose w-8 h-8 bottom-[14%] left-[14%] sky-float-slow" />
      </div>
      {/* Back to the landing page — /login is often opened directly. */}
      <a
        href="/"
        aria-label="Back to Cotly"
        className="absolute top-5 left-5 md:top-8 md:left-8 z-10 inline-flex items-center gap-2 no-underline text-[#1e1b4b]/70 hover:text-[#1e1b4b] text-sm rounded-lg px-3 py-2 border border-white/60 bg-white/30 hover:bg-white/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e1b4b]/50"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Cotly
      </a>
      <div className="relative w-full max-w-[420px] sky-glass rounded-3xl p-8">
        <div className="flex items-center justify-center text-[#1e1b4b]">
          <Logo markClass="w-5 h-5" wordClass="text-lg font-semibold tracking-tight" />
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl border border-[#1e1b4b]/15 bg-white/70 px-3 py-2.5 text-sm text-[#1e1b4b] placeholder:text-[#1e1b4b]/40 outline-none focus:border-[#5b6cf5] focus:ring-2 focus:ring-[#5b6cf5]/30';

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
      <span className="text-xs font-medium text-[#1e1b4b]/60">{label}</span>
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
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-[#1e1b4b]/60 hover:text-[#1e1b4b] hover:bg-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b6cf5]/60"
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
      <h1 className="text-[#1e1b4b] font-instrument text-3xl font-medium tracking-tight text-center mt-6">Welcome back.</h1>
      <p className="text-[#1e1b4b]/60 text-sm text-center mt-1.5">
        Post once. Get on with your <span className="font-instrument italic">day.</span>
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
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
          <PasswordField value={password} onChange={setPassword} />
        </div>

        {err && (
          <p className="text-sm text-red-700" role="alert">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 w-full rounded-lg bg-[#232671] text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-[#2d3090] disabled:opacity-60 shadow-lg shadow-[#232671]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#232671]/60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-[#1e1b4b]/60 text-center mt-6">
        New to Cotly?{' '}
        <a
          href="/signup"
          onClick={(e) => {
            e.preventDefault();
            onNav('/signup');
          }}
          className="text-[#312e81] font-semibold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b6cf5]/60 rounded"
        >
          Create account
        </a>
      </p>
    </AuthShell>
  );
}
