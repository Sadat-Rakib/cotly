import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, providerLabel, type Me } from '../api';
import { useToast } from '../components/Toasts';
import {
  OAUTH_PROVIDER_META,
  callbackUrlFor,
  isOAuthProvider,
  type SetupStatus,
} from '../setupStatus';

interface Props {
  me: Me;
  navigate: (p: string) => void;
}

type CheckState = 'ok' | 'down' | 'unknown';

interface CheckRow {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  why: string;
}

function deploymentRows(s: SetupStatus): CheckRow[] {
  const d = s.deployment;
  const cronState: CheckState = d.cron === true ? 'ok' : d.cron === false ? 'down' : 'unknown';
  const urlLooksProd = /^https:\/\//.test(d.appUrl) && !/localhost|127\.0\.0\.1/.test(d.appUrl);
  const mediaOk = d.mediaPresignReady && d.r2;
  return [
    {
      key: 'd1',
      label: 'Database (D1)',
      state: d.d1 ? 'ok' : 'down',
      detail: d.d1 ? 'Reachable' : 'Not reachable',
      why: 'Stores your posts, queue, connected accounts and history.',
    },
    {
      key: 'r2',
      label: 'Object storage (R2)',
      state: d.r2 ? 'ok' : 'down',
      detail: d.r2 ? 'Reachable' : 'Not reachable',
      why: 'Keeps the images and videos you upload.',
    },
    {
      key: 'cron',
      label: 'Scheduler (cron)',
      state: cronState,
      detail: d.cron === true
        ? 'Running — a tick was seen recently'
        : d.cron === false
          ? 'No recent tick — the cron trigger may be missing'
          : 'Unknown in local dev (cron only runs on a deployed Worker)',
      why: 'Publishes scheduled posts on time, every minute.',
    },
    {
      key: 'appUrl',
      label: 'Production URL',
      state: urlLooksProd ? 'ok' : 'unknown',
      detail: d.appUrl || '(not set)',
      why: 'OAuth providers redirect back to this address, so it must match the deployed Worker.',
    },
    {
      key: 'encryption',
      label: 'Encryption secret',
      state: d.encryptionSecretSet ? 'ok' : 'down',
      detail: d.encryptionSecretSet ? 'Set' : 'Not set',
      why: 'Encrypts the access tokens Cotly stores for your accounts.',
    },
    {
      key: 'session',
      label: 'Session secret',
      state: d.sessionSecretSet ? 'ok' : 'down',
      detail: d.sessionSecretSet ? 'Set' : 'Not set',
      why: 'Signs your login session cookie.',
    },
    {
      key: 'media',
      label: 'Media uploads',
      state: mediaOk ? 'ok' : 'down',
      detail: mediaOk
        ? 'Direct-to-storage uploads ready'
        : 'Missing R2 upload credentials (R2_ACCOUNT_ID / ACCESS_KEY / SECRET)',
      why: 'Lets your browser upload media straight to storage when composing.',
    },
  ];
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function SetupCenterPage({ me, navigate }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [mockName, setMockName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<SetupStatus>('/api/setup/status'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load setup status');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // MockSocial section shows when the server reports mock enabled
  // (me.mockEnabled) or a mock account already exists.
  const mockEnabled = me.mockEnabled === true
    || (status?.accounts ?? []).some((a) => a.provider === 'mock');

  const connectOAuth = async (provider: string) => {
    setBusy(`oauth-${provider}`);
    try {
      const { url } = await api<{ url: string }>(`/api/oauth/${provider}/start`);
      window.location.href = url;
    } catch (e) {
      toast('err', e instanceof ApiError ? e.message : 'Could not start sign-in');
    } finally {
      setBusy(null);
    }
  };

  const connectBsky = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('bluesky');
    try {
      await api('/api/accounts/bluesky', { method: 'POST', body: { handle: bskyHandle, appPassword: bskyPassword } });
      toast('ok', 'Bluesky connected');
      setBskyHandle('');
      setBskyPassword('');
      await load();
    } catch (ex) {
      toast('err', ex instanceof ApiError ? ex.message : 'Could not connect Bluesky');
    } finally {
      setBusy(null);
    }
  };

  const connectMock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('mock');
    try {
      await api('/api/accounts/mock', { method: 'POST', body: { displayName: mockName || 'Mock account' } });
      toast('ok', 'MockSocial account added');
      setMockName('');
      await load();
    } catch (ex) {
      const msg = ex instanceof ApiError ? ex.message : 'Could not add MockSocial account';
      if (ex instanceof ApiError && ex.status === 404) toast('info', 'MockSocial is not enabled (set MOCK_SOCIAL_ENABLED=true)');
      else toast('err', msg);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? 'ok' : 'err', ok ? 'Copied to clipboard' : 'Copy failed — select the text manually');
  };

  if (err && !status) {
    return (
      <div className="setup-center">
        <h1>Setup</h1>
        <div className="empty card"><p className="error-text">{err}</p></div>
      </div>
    );
  }
  if (!status) return <div className="skeleton" style={{ height: 240 }} />;

  const rows = deploymentRows(status);
  const accountsByProvider = new Map<string, string[]>();
  for (const a of status.accounts) {
    const list = accountsByProvider.get(a.provider) ?? [];
    list.push(a.displayName);
    accountsByProvider.set(a.provider, list);
  }

  return (
    <div className="setup-center">
      <h1>Setup</h1>
      <p className="hint">
        Signed in as {status.owner.exists ? status.owner.email : me.email}.
        Real state only — a green check here means the check actually passed.
      </p>

      <section className="card">
        <h2>Deployment checks</h2>
        <div className="check-list">
          {rows.map((r) => (
            <div key={r.key} className="check-row">
              <span className={`check-dot check-${r.state}`} aria-hidden="true" />
              <div className="check-main">
                <span className="check-label">
                  {r.label}
                  <span className={`check-state check-state-${r.state}`}>
                    {r.state === 'ok' ? 'OK' : r.state === 'down' ? 'Problem' : 'Unknown'}
                  </span>
                </span>
                <span className="check-detail">{r.detail}</span>
                <span className="check-why">{r.why}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Platforms</h2>
        {status.providers.map((p) => {
          const meta = isOAuthProvider(p.provider) ? OAUTH_PROVIDER_META[p.provider] : undefined;
          const names = accountsByProvider.get(p.provider) ?? [];
          return (
            <div key={p.provider} className="platform-row">
              <div className="platform-head">
                <span className="platform-name">{providerLabel(p.provider)}</span>
                <span className={`plat-badge plat-${p.badge === 'connected' ? 'ready' : p.badge === 'ready_to_connect' ? 'soon' : 'muted'}`}>
                  {p.badge.replace(/_/g, ' ')}
                </span>
                {p.badge === 'ready_to_connect' && meta && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy === `oauth-${p.provider}`}
                    onClick={() => void connectOAuth(p.provider)}
                  >
                    Connect
                  </button>
                )}
                {p.badge === 'needs_reconnect' && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => navigate('/app/accounts')}>
                    Reconnect on Accounts
                  </button>
                )}
              </div>
              {p.reason && <p className="hint">{p.reason}</p>}
              {names.length > 0 && <p className="hint">Connected: {names.join(', ')}</p>}

              {meta && !p.configured && (
                <details className="setup-details">
                  <summary>Action needed from you</summary>
                  <ol className="setup-steps">
                    <li>
                      Open the {meta.portalName} developer portal ({' '}
                      <a href={meta.portal} target="_blank" rel="noreferrer">{meta.portal}</a>{' '}
                      ) and create a {meta.appType} app.
                    </li>
                    <li>
                      <span>Add this exact OAuth redirect URI in the app settings:</span>
                      <span className="callback-row">
                        <code className="code">{callbackUrlFor(status.deployment.appUrl, p.provider)}</code>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void copy(callbackUrlFor(status.deployment.appUrl, p.provider))}
                        >
                          Copy
                        </button>
                      </span>
                    </li>
                    <li>
                      Give Cotly the two values <code className="code">{meta.idEnv}</code> and{' '}
                      <code className="code">{meta.secretEnv}</code> — <code className="code">wrangler secret put {meta.idEnv}</code>{' '}
                      (or <code className="code">.dev.vars</code> locally).
                    </li>
                    <li>
                      Verify: click Connect, approve access, then send a test post from Compose and
                      confirm it appears in the Queue.
                    </li>
                  </ol>
                </details>
              )}

              {p.provider === 'bluesky' && (
                <form className="inline-form" onSubmit={(e) => void connectBsky(e)}>
                  <input className="input" placeholder="handle.bsky.social" value={bskyHandle}
                    onChange={(e) => setBskyHandle(e.target.value)} required aria-label="Bluesky handle" />
                  <input className="input" type="password" placeholder="App password" value={bskyPassword}
                    onChange={(e) => setBskyPassword(e.target.value)} required aria-label="Bluesky app password" />
                  <button className="btn btn-primary" type="submit" disabled={busy === 'bluesky'}>
                    {busy === 'bluesky' ? 'Connecting…' : 'Connect'}
                  </button>
                </form>
              )}
              {p.provider === 'bluesky' && (
                <p className="hint">
                  Create an app password at{' '}
                  <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">bsky.app/settings/app-passwords</a>.
                </p>
              )}

              {p.provider === 'mock' && mockEnabled && (
                <form className="inline-form" onSubmit={(e) => void connectMock(e)}>
                  <input className="input" placeholder="Display name" value={mockName}
                    onChange={(e) => setMockName(e.target.value)} aria-label="MockSocial display name" />
                  <button className="btn btn-primary" type="submit" disabled={busy === 'mock'}>
                    {busy === 'mock' ? 'Adding…' : 'Add'}
                  </button>
                </form>
              )}
            </div>
          );
        })}

        {!mockEnabled && (
          <p className="hint">
            MockSocial (the built-in test provider) appears here once it is enabled
            (MOCK_SOCIAL_ENABLED=true) — the Accounts page can add it in the meantime.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Launch checklist</h2>
        <ul className="checklist">
          {status.checklist.map((c) => (
            <li key={c.key}>
              <span className={`check-dot ${c.done ? 'check-ok' : 'check-unknown'}`} aria-hidden="true" />
              <span className={c.done ? '' : 'check-why'}>{c.label}</span>
              <span className="check-state check-state-unknown">{c.done ? 'done' : 'not yet'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>More</h2>
        <div className="settings-links">
          <button type="button" className="btn" onClick={() => navigate('/app/diagnostics')}>Open diagnostics</button>
          <button type="button" className="btn" onClick={() => navigate('/app/accounts')}>Manage accounts</button>
        </div>
      </section>
    </div>
  );
}
