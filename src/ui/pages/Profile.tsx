import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api, providerLabel, type Account, type Me, type Provider, type Settings as SettingsShape } from '../api';
import { StatusBadge } from '../components/Badge';
import { TimezoneSelect } from '../components/TimezoneSelect';
import { useToast } from '../components/Toasts';
import { relTime } from '../time';

interface Props {
  me: Me;
  onLogout: () => void;
}

interface ProviderCard {
  provider: Provider;
  label: string;
  blurb: string;
  /** Connect flow: OAuth redirect vs. a small inline form. */
  flow: 'oauth' | 'form' | 'dev';
}

const CARDS: ProviderCard[] = [
  {
    provider: 'threads',
    label: 'Threads',
    blurb: 'Publish to your Threads account. Posts go live after a short processing step.',
    flow: 'oauth',
  },
  {
    provider: 'x',
    label: 'X',
    blurb: 'Post to your X account. Publishing is pay-per-post and guarded by a monthly budget.',
    flow: 'oauth',
  },
  {
    provider: 'facebook',
    label: 'Facebook Pages',
    blurb: 'Publish to a Page you manage. Cotly never posts to personal profiles.',
    flow: 'oauth',
  },
  {
    provider: 'instagram',
    label: 'Instagram',
    blurb: 'Publish to your Business or Creator account. Image posts only for now.',
    flow: 'oauth',
  },
  {
    provider: 'bluesky',
    label: 'Bluesky',
    blurb: 'Sign in with your handle and an app password.',
    flow: 'form',
  },
  {
    provider: 'mock',
    label: 'MockSocial',
    blurb: 'Built-in test provider. Never publishes anything real.',
    flow: 'dev',
  },
];

interface PageOption {
  id: string;
  name: string;
}

interface MediaStats {
  objectCount: number;
  totalBytes: number;
  cleanedTotal: number;
  lastCleanupAt: number | null;
  storageReady: boolean;
}

const DEFAULT_SETTINGS: SettingsShape = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  mediaRetentionHours: 168,
  xBudgetMode: 'disabled',
  xBudgetMonthlyUsd: 0,
};

const msg = (e: unknown): string => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ProfilePage({ me, onLogout }: Props) {
  const toast = useToast();

  // --- Connected accounts state (absorbed from Accounts) ---
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [mockName, setMockName] = useState('');
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pageBusy, setPageBusy] = useState<string | null>(null);
  const [igToken, setIgToken] = useState('');

  // --- Preferences state (absorbed from Settings) ---
  const [s, setS] = useState<SettingsShape | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  // --- Storage diagnostics ---
  const [media, setMedia] = useState<MediaStats | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await api<Account[]>('/api/accounts'));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) toast('err', msg(e));
    } finally {
      setAccountsLoading(false);
    }
  }, [toast]);

  // OAuth callback lands here with ?connected / ?error / ?choose_page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) {
      const p = q.get('provider');
      toast('ok', p ? `${providerLabel(p)} connected.` : 'Account connected.');
    }
    const err = q.get('error');
    if (err) toast('err', err);
    const choose = q.get('choose_page');
    if (choose === 'facebook') {
      api<{ pages: PageOption[] }>('/api/accounts/facebook/pages')
        .then((r) => setPages(r.pages.length > 0 ? r.pages : []))
        .catch((e) => toast('err', msg(e)));
    }
    if (q.has('connected') || err || choose) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast]);

  useEffect(() => {
    void loadAccounts();
    api<SettingsShape>('/api/settings')
      .then(setS)
      .catch((e) => toast('err', msg(e)));
    api<{ media: MediaStats }>('/api/diagnostics')
      .then((d) => setMedia(d.media ?? null))
      .catch(() => { /* storage card is informational */ });
  }, [loadAccounts, toast]);

  const byProvider = useCallback((p: Provider) => accounts.filter((a) => a.provider === p), [accounts]);
  const needsReconnect = useMemo(() => accounts.filter((a) => a.status === 'needs_reconnect'), [accounts]);

  const connect = async (card: ProviderCard) => {
    setBusy(card.provider);
    try {
      const { url } = await api<{ url: string }>(`/api/oauth/${card.provider}/start`);
      window.location.href = url;
    } catch (e) {
      toast('err', e instanceof ApiError && e.status === 400 ? `${card.label} is not configured yet on this deployment.` : msg(e));
      setBusy(null);
    }
  };

  const connectBsky = async () => {
    setBusy('bluesky');
    try {
      await api('/api/accounts/bluesky', { method: 'POST', body: { handle: bskyHandle, appPassword: bskyPassword } });
      toast('ok', 'Bluesky connected.');
      setBskyHandle('');
      setBskyPassword('');
      await loadAccounts();
    } catch (e) {
      toast('err', msg(e));
    } finally {
      setBusy(null);
    }
  };

  const connectInstagramToken = async () => {
    setBusy('instagram');
    try {
      await api('/api/accounts/instagram/token', { method: 'POST', body: { accessToken: igToken } });
      toast('ok', 'Instagram connected.');
      setIgToken('');
      await loadAccounts();
    } catch (e) {
      toast('err', msg(e));
    } finally {
      setBusy(null);
    }
  };

  const connectMock = async () => {
    setBusy('mock');
    try {
      await api('/api/accounts/mock', { method: 'POST', body: { displayName: mockName || 'Mock account' } });
      toast('ok', 'MockSocial account added.');
      setMockName('');
      await loadAccounts();
    } catch (e) {
      toast('info', e instanceof ApiError && e.status === 404 ? 'MockSocial is disabled on this deployment.' : msg(e));
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async (a: Account) => {
    const label = `${providerLabel(a.provider)} · ${a.displayName}${a.handle ? ` (@${a.handle})` : ''}`;
    setBusy(a.provider);
    try {
      const r = await api<{ ok: boolean; detail: string }>(`/api/accounts/${a.id}/test`, { method: 'POST' });
      if (r.ok) {
        toast('ok', `${label}: ${r.detail}`);
        await loadAccounts();
      } else {
        toast('err', `${label}: ${r.detail || 'Connection check failed.'}`);
      }
    } catch (e) {
      toast('info', `${label}: ${msg(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (a: Account) => {
    if (!window.confirm(`Disconnect ${a.displayName} (${providerLabel(a.provider)})?`)) return;
    setBusy(a.provider);
    try {
      await api(`/api/accounts/${a.id}`, { method: 'DELETE' });
      toast('ok', `${a.displayName} disconnected.`);
      await loadAccounts();
    } catch (e) {
      toast('err', msg(e));
    } finally {
      setBusy(null);
    }
  };

  const choosePage = async (page: PageOption) => {
    setPageBusy(page.id);
    try {
      await api('/api/accounts/facebook/pages', { method: 'POST', body: { pageId: page.id } });
      setPages(null);
      toast('ok', `${page.name} connected.`);
      await loadAccounts();
    } catch (e) {
      toast('err', msg(e));
    } finally {
      setPageBusy(null);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setSettingsBusy(true);
    try {
      const saved = await api<SettingsShape>('/api/settings', { method: 'PUT', body: s });
      setS(saved);
      toast('ok', 'Settings saved.');
    } catch (ex) {
      toast('err', msg(ex));
    } finally {
      setSettingsBusy(false);
    }
  };

  const cur = s ?? DEFAULT_SETTINGS;
  const set = (patch: Partial<SettingsShape>) => setS({ ...cur, ...patch });

  // Retention choices: 3 days / 7 days (default). If the deployment was
  // previously set to something else, keep it visible instead of silently
  // coercing the stored value.
  const retentionOptions: Array<{ value: string; label: string }> = [
    { value: '168', label: 'After 7 days (default)' },
    { value: '72', label: 'After 3 days' },
  ];
  if (cur.mediaRetentionHours !== null && !['72', '168'].includes(String(cur.mediaRetentionHours))) {
    retentionOptions.push({ value: String(cur.mediaRetentionHours), label: `After ${Math.round(cur.mediaRetentionHours / 24)} days (current)` });
  }
  if (cur.mediaRetentionHours === null) {
    retentionOptions.push({ value: 'never', label: 'Never delete (current)' });
  }

  return (
    <div className="profile">
      <h1>Profile</h1>
      <p className="hint">Your account, connections, and preferences — all in one place.</p>

      {/* ---------- User information ---------- */}
      <section className="card">
        <h2>Account</h2>
        <div className="profile-user">
          <span className="avatar avatar-fallback profile-avatar" aria-hidden="true">
            {me.email.charAt(0).toUpperCase()}
          </span>
          <div className="profile-user-id">
            <span className="profile-email">{me.email}</span>
            <span className="account-verified">Timezone: {me.timezone}</span>
          </div>
        </div>
      </section>

      {/* ---------- Connected social accounts ---------- */}
      <section className="card">
        <h2>Connected accounts</h2>
        <p className="hint">
          Connect the places you post to. Tokens are encrypted at rest and never shown here.
        </p>

        {needsReconnect.length > 0 && (
          <div className="banner banner-warn" role="alert">
            <span>
              Reconnect needed:{' '}
              {needsReconnect.map((a) => `${providerLabel(a.provider)} (${a.displayName})`).join(', ')}
            </span>
            <button className="btn btn-sm" onClick={() => void loadAccounts()}>Refresh</button>
          </div>
        )}

        {pages && (
          <div className="page-chooser" role="dialog" aria-label="Choose a Facebook Page">
            <h3>Which Page should Cotly post to?</h3>
            {pages.length === 0 ? (
              <p className="hint">
                Meta returned no Pages for this account. Create a Page, or make sure this account
                has a role on one, then start the connection again.
              </p>
            ) : (
              <ul className="account-list">
                {pages.map((p) => (
                  <li key={p.id} className="account-row">
                    <span className="dest-name">{p.name}</span>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={pageBusy !== null}
                      onClick={() => void choosePage(p)}
                    >
                      {pageBusy === p.id ? 'Connecting…' : 'Use this Page'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setPages(null)}>Cancel</button>
          </div>
        )}

        {accountsLoading && <div className="skeleton" style={{ height: 120 }} />}

        {CARDS.map((card) => {
          if (card.flow === 'dev' && !me.mockEnabled) return null;
          const list = byProvider(card.provider);
          return (
            <div key={card.provider} className="account-card">
              <div className="account-head">
                <div>
                  <h3>{card.label}</h3>
                  <p className="hint">{card.blurb}</p>
                </div>
                {card.flow === 'oauth' && list.length === 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === card.provider}
                    onClick={() => void connect(card)}
                  >
                    {busy === card.provider ? 'Opening…' : 'Connect'}
                  </button>
                )}
              </div>

              {card.provider === 'instagram' && list.length === 0 && (
                <>
                  <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void connectInstagramToken(); }}>
                    <input
                      className="input"
                      type="password"
                      placeholder="Paste an Instagram access token…"
                      value={igToken}
                      onChange={(e) => setIgToken(e.target.value)}
                      required
                      aria-label="Instagram access token"
                    />
                    <button className="btn btn-sm" type="submit" disabled={busy === 'instagram'}>
                      {busy === 'instagram' ? 'Connecting…' : 'Connect with token'}
                    </button>
                  </form>
                  <p className="hint">
                    Optional: if you already have a long-lived Instagram access token (Meta Access
                    Token tool / developer console), paste it here to connect without the OAuth
                    redirect. The account must be Business or Creator.
                  </p>
                </>
              )}

              {card.provider === 'bluesky' && list.length === 0 && (
                <>
                  <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void connectBsky(); }}>
                    <input
                      className="input"
                      placeholder="handle.bsky.social"
                      value={bskyHandle}
                      onChange={(e) => setBskyHandle(e.target.value)}
                      required
                      aria-label="Bluesky handle"
                    />
                    <input
                      className="input"
                      type="password"
                      placeholder="App password"
                      value={bskyPassword}
                      onChange={(e) => setBskyPassword(e.target.value)}
                      required
                      aria-label="Bluesky app password"
                    />
                    <button className="btn btn-primary btn-sm" type="submit" disabled={busy === 'bluesky'}>
                      {busy === 'bluesky' ? 'Connecting…' : 'Connect'}
                    </button>
                  </form>
                  <p className="hint">
                    Create an app password at bsky.app/settings/app-passwords. It is shown once — paste
                    it here and it is encrypted immediately.
                  </p>
                </>
              )}

              {card.flow === 'dev' && list.length === 0 && (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void connectMock(); }}>
                  <input
                    className="input"
                    placeholder="Display name"
                    value={mockName}
                    onChange={(e) => setMockName(e.target.value)}
                    aria-label="MockSocial display name"
                  />
                  <button className="btn btn-sm" type="submit" disabled={busy === 'mock'}>
                    {busy === 'mock' ? 'Adding…' : 'Add test account'}
                  </button>
                </form>
              )}

              {list.length > 0 ? (
                <ul className="account-list">
                  {list.map((a) => (
                    <li key={a.id} className="account-row">
                      <div className="account-info">
                        {a.avatarUrl ? (
                          <img className="avatar" src={a.avatarUrl} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="avatar avatar-fallback" aria-hidden="true">
                            {a.displayName.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="account-id">
                          <span className="dest-name">{a.displayName}</span>
                          <span className="account-verified">Last verified: {relTime(a.lastVerifiedAt)}</span>
                        </div>
                        <StatusBadge status={a.status} />
                      </div>
                      <div className="account-actions">
                        <button
                          className="btn btn-sm"
                          disabled={busy === card.provider}
                          onClick={() => void testConnection(a)}
                        >
                          Test connection
                        </button>
                        {card.flow === 'oauth' && (
                          <button
                            className="btn btn-sm"
                            disabled={busy === card.provider}
                            onClick={() => void connect(card)}
                          >
                            Reconnect
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busy === card.provider}
                          onClick={() => void disconnect(a)}
                        >
                          Disconnect
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                !accountsLoading &&
                card.flow === 'oauth' && <p className="hint">Not connected.</p>
              )}
            </div>
          );
        })}
      </section>

      {/* ---------- Preferences ---------- */}
      <form className="card" onSubmit={saveSettings}>
        <h2>Preferences</h2>

        <div className="field">
          <span className="label">Timezone (used for smart scheduling)</span>
          <TimezoneSelect value={cur.timezone} onChange={(tz) => set({ timezone: tz })} />
        </div>

        <div className="field">
          <label className="label" htmlFor="retention">Delete uploaded media</label>
          <select
            id="retention"
            className="select"
            value={cur.mediaRetentionHours === null ? 'never' : String(cur.mediaRetentionHours)}
            onChange={(e) => set({ mediaRetentionHours: e.target.value === 'never' ? null : Number(e.target.value) })}
          >
            {retentionOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="hint">
            Uploaded media is automatically removed after 7 days unless you choose a shorter
            retention period. Posts that were already published are never affected, and storage
            never grows endlessly — the scheduler cleans expired uploads automatically.
          </p>
        </div>

        <div className="field">
          <label className="label" htmlFor="xbudget">X (Twitter) budget mode</label>
          <select
            id="xbudget"
            className="select"
            value={cur.xBudgetMode}
            onChange={(e) => set({ xBudgetMode: e.target.value as SettingsShape['xBudgetMode'] })}
          >
            <option value="disabled">Disabled</option>
            <option value="warn">Warn</option>
            <option value="hard">Hard cap</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="xbudget-usd">X monthly spend cap (USD)</label>
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

        <button className="btn btn-primary" type="submit" disabled={settingsBusy || !s}>
          {settingsBusy ? 'Saving…' : 'Save preferences'}
        </button>
      </form>

      {/* ---------- Storage diagnostics ---------- */}
      <section className="card">
        <h2>Media storage</h2>
        {!media ? (
          <p className="hint">Storage diagnostics load with the next scheduler tick.</p>
        ) : (
          <>
            <div className="stat-grid stat-grid-4">
              <div className="stat-card">
                <span className="stat-label">Objects</span>
                <span className="stat-value">{media.objectCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Total size</span>
                <span className="stat-value">{formatBytes(media.totalBytes)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Cleaned (all time)</span>
                <span className="stat-value">{media.cleanedTotal}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Last cleanup</span>
                <span className="stat-value">{media.lastCleanupAt ? relTime(media.lastCleanupAt) : 'Not yet'}</span>
              </div>
            </div>
            <p className="hint">
              {media.storageReady
                ? 'Object storage is connected. Expired uploads are removed automatically by the scheduler.'
                : 'Object storage is not configured on this deployment yet — text-only posts still work.'}
            </p>
          </>
        )}
      </section>

      {/* ---------- Session ---------- */}
      <section className="card">
        <h2>Session</h2>
        <div className="settings-links">
          <button type="button" className="btn btn-ghost" onClick={onLogout}>Log out ({me.email})</button>
        </div>
      </section>
    </div>
  );
}
