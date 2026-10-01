import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Me, type Settings } from '../api';
import { TimezoneSelect } from '../components/TimezoneSelect';
import { useToast } from '../components/Toasts';

interface Props {
  me: Me;
  navigate: (p: string) => void;
  onLogout: () => void;
}

const DEFAULTS: Settings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  mediaRetentionHours: 48,
  xBudgetMode: 'disabled',
  xBudgetMonthlyUsd: 0,
};

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cotly_theme', next); } catch { /* private mode */ }
}

export function SettingsPage({ me, navigate, onLogout }: Props) {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>('/api/settings')
      .then(setS)
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load settings'));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/settings', { method: 'PUT', body: s });
      toast('ok', 'Settings saved.');
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  };

  if (!s && !err) return <div className="skeleton" style={{ height: 200 }} />;

  const cur = s ?? DEFAULTS;
  const set = (patch: Partial<Settings>) => setS({ ...cur, ...patch });

  return (
    <form className="settings" onSubmit={save}>
      <h1>Settings</h1>

      {err && <p className="error-text" role="alert">{err}</p>}

      <section className="card">
        <h2>General</h2>
        <div className="field">
          <span className="label">Timezone (used for smart scheduling)</span>
          <TimezoneSelect value={cur.timezone} onChange={(tz) => set({ timezone: tz })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="retention">Media retention</label>
          <select
            id="retention"
            className="select"
            value={cur.mediaRetentionHours === null ? 'never' : String(cur.mediaRetentionHours)}
            onChange={(e) => set({ mediaRetentionHours: e.target.value === 'never' ? null : Number(e.target.value) })}
          >
            <option value="24">24 hours</option>
            <option value="48">48 hours</option>
            <option value="72">72 hours</option>
            <option value="168">7 days</option>
            <option value="never">Never delete</option>
          </select>
          <p className="hint">Uploaded media is removed from storage this long after a post finishes.</p>
        </div>
      </section>

      <section className="card">
        <h2>X (Twitter) budget</h2>
        <div className="field">
          <label className="label" htmlFor="xbudget">Mode</label>
          <select
            id="xbudget"
            className="select"
            value={cur.xBudgetMode}
            onChange={(e) => set({ xBudgetMode: e.target.value as Settings['xBudgetMode'] })}
          >
            <option value="disabled">Disabled</option>
            <option value="warn">Warn</option>
            <option value="hard">Hard cap</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="xbudget-usd">Monthly spend cap (USD)</label>
          <input
            id="xbudget-usd"
            className="input"
            type="number"
            min={0}
            step="0.01"
            value={cur.xBudgetMonthlyUsd}
            onChange={(e) => set({ xBudgetMonthlyUsd: Number(e.target.value) || 0 })}
          />
        </div>
        <p className="hint">X adapter not built yet; settings apply when it ships.</p>
      </section>

      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>

      <section className="card">
        <h2>More</h2>
        <div className="settings-links">
          <button type="button" className="btn" onClick={() => navigate('/diagnostics')}>Open diagnostics</button>
          <button type="button" className="btn" onClick={toggleTheme}>Toggle light / dark theme</button>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>Log out ({me.email})</button>
        </div>
      </section>
    </form>
  );
}
