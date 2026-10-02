import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
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

interface MetaTestRow {
  provider: string;
  appId: string;
  configured: boolean;
  reachable: boolean;
  ok: boolean;
  detail: string;
}

const META_STEPS: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Create a Meta developer app',
    body: (
      <>
        Open the Meta Developer Dashboard, choose <strong>My Apps → Create App</strong>, and pick the{' '}
        <strong>Business</strong> app type. Name it <code className="code">Cotly</code>. This is the only
        step that needs your Meta login.
      </>
    ),
  },
  {
    title: 'Add the Facebook and Threads products',
    body: (
      <>
        On the app dashboard click <strong>Add product</strong> and add both <strong>Facebook</strong>{' '}
        (for Login for Business, so Cotly can post to Pages) and <strong>Threads</strong>. Cotly talks to
        the official Graph APIs for both — nothing is automated through a browser.
      </>
    ),
  },
  {
    title: 'Set the OAuth redirect URIs',
    body: (
      <>
        In each product's settings paste the callback below and Save. Both must match exactly, including
        the trailing path.
      </>
    ),
  },
  {
    title: 'Request the permissions Cotly needs',
    body: (
      <>
        Under <strong>Facebook → Permissions and Features</strong> request{' '}
        <code className="code">pages_show_list</code>, <code className="code">pages_manage_posts</code> and{' '}
        <code className="code">pages_read_engagement</code>. Under{' '}
        <strong>Threads → Permissions</strong> request <code className="code">threads_basic</code> and{' '}
        <code className="code">threads_content_publish</code>. Add them as products, then request
        Advanced Access when Meta offers it.
      </>
    ),
  },
  {
    title: 'Give Cotly the App ID and App Secret',
    body: (
      <>
        Both live under <strong>Settings → Basic</strong> on the app dashboard. Cotly keeps the secret in
        Cloudflare, never in the browser. You paste them yourself with{' '}
        <code className="code">wrangler secret put</code> — Cotly will not read them from the dashboard.
      </>
    ),
  },
  {
    title: 'Test the configuration',
    body: <>Run the test below. It asks Meta who the app is using your App ID + App Secret. It publishes nothing and grants nothing.</>,
  },
  {
    title: 'Connect the accounts',
    body: <>Connect Facebook Pages and Threads from here or the Accounts page. Cotly only ever targets Facebook Pages, never a personal profile.</>,
  },
];

export function SetupCenterPage({ me, navigate }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [mockName, setMockName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [metaResults, setMetaResults] = useState<MetaTestRow[] | null>(null);
  const [metaNote, setMetaNote] = useState('');

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

  // POST /api/setup/test-meta — read-only probe. It asks Meta which app the
  // App ID + App Secret belong to. Nothing is published and nothing is granted.
  const testMeta = async () => {
    setBusy('meta');
    try {
      const r = await api<{ results: MetaTestRow[]; note?: string }>('/api/setup/test-meta', { method: 'POST' });
      setMetaResults(r.results);
      setMetaNote(r.note ?? '');
      const allOk = r.results.every((x) => x.ok);
      toast(allOk ? 'ok' : 'info', allOk ? 'Meta credentials verified.' : 'Some Meta credentials are still missing.');
    } catch (e) {
      toast('err', e instanceof ApiError ? e.message : 'Could not test the Meta configuration');
    } finally {
      setBusy(null);
    }
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
        <h2>Connect Facebook Pages and Threads</h2>
        <p className="hint">
          Seven steps, in order. Everything above them is automatic — these are the parts that need your
          Meta login and your approval.
        </p>

        <ol className="setup-steps">
          {META_STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="setup-step-title">{step.title}</span>
              <p className="setup-step-body">{step.body}</p>

              {i === 0 && (
                <a
                  className="btn btn-primary btn-sm"
                  href="https://developers.facebook.com/apps"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Meta Developer Dashboard
                </a>
              )}

              {i === 2 &&
                (['facebook', 'threads'] as const).map((prov) => {
                  const url = callbackUrlFor(status.deployment.appUrl, prov);
                  return (
                    <div key={prov} className="callback-row">
                      <span className="callback-label">{providerLabel(prov)}</span>
                      <code className="code">{url}</code>
                      <button type="button" className="btn btn-sm" onClick={() => void copy(url)}>Copy</button>
                    </div>
                  );
                })}

              {i === 4 &&
                (['facebook', 'threads'] as const).map((prov) => {
                  const m = OAUTH_PROVIDER_META[prov];
                  if (!m) return null;
                  const idCmd = `wrangler secret put ${m.idEnv}`;
                  const secretCmd = `wrangler secret put ${m.secretEnv}`;
                  return (
                    <div key={prov} className="callback-row">
                      <span className="callback-label">{providerLabel(prov)}</span>
                      <code className="code">{idCmd}</code>
                      <button type="button" className="btn btn-sm" onClick={() => void copy(idCmd)}>
                        Copy
                      </button>
                      <code className="code">{secretCmd}</code>
                      <button type="button" className="btn btn-sm" onClick={() => void copy(secretCmd)}>
                        Copy
                      </button>
                    </div>
                  );
                })}

              {i === 5 && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy === 'meta'}
                    onClick={() => void testMeta()}
                  >
                    {busy === 'meta' ? 'Testing…' : 'Test Meta configuration'}
                  </button>
                  {metaResults && (
                    <ul className="check-list">
                      {metaResults.map((m) => (
                        <li key={m.provider} className="check-row">
                          <span className={`check-dot ${m.ok ? 'check-ok' : 'check-down'}`} aria-hidden="true" />
                          <div className="check-main">
                            <span className="check-label">
                              {providerLabel(m.provider)}
                              <span className={`check-state ${m.ok ? 'check-state-ok' : 'check-state-down'}`}>
                                {m.ok ? 'Verified' : m.configured ? 'Rejected by Meta' : 'Not configured'}
                              </span>
                            </span>
                            <span className="check-detail">{m.detail}</span>
                            {m.appId && <span className="check-why">App ID {m.appId}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {metaNote && <p className="hint">{metaNote}</p>}
                </>
              )}

              {i === 6 && (
                <div className="settings-links">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy === 'oauth-facebook'}
                    onClick={() => void connectOAuth('facebook')}
                  >
                    Connect Facebook Page
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy === 'oauth-threads'}
                    onClick={() => void connectOAuth('threads')}
                  >
                    Connect Threads
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {!status.deployment.r2 && (
        <section className="card">
          <h2>Media uploads</h2>
          <div className="banner banner-warn">
            <span>Media uploads unavailable until R2 is enabled.</span>
          </div>
          <p className="hint">
            Cotly keeps uploads in Cloudflare R2, which is not enabled on this account yet. Everything
            else — scheduling, text posts, Facebook, Threads — works without it. To turn uploads on:
          </p>
          <ol className="setup-steps">
            <li>
              Open{' '}
              <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">dash.cloudflare.com</a>{' '}
              and choose <strong>R2 Object Storage</strong> in the sidebar.
            </li>
            <li>
              Click <strong>Enable R2</strong> and accept the terms. R2 has a free tier; Cotly does not
              add any other paid storage provider.
            </li>
            <li>
              Under <strong>Buckets</strong>, create a bucket called <code className="code">cotly-media</code>.
            </li>
            <li>
              Under <strong>R2 → API Tokens → Create Account API token</strong>, give it{' '}
              <strong>Object Read &amp; Write</strong> permission scoped to that bucket, and copy the
              Access Key ID, Secret Access Key and the Account ID it shows.
            </li>
            <li>
              Set them as Worker secrets, then redeploy:
              <span className="callback-row"><code className="code">wrangler secret put R2_ACCOUNT_ID</code></span>
              <span className="callback-row"><code className="code">wrangler secret put R2_ACCESS_KEY_ID</code></span>
              <span className="callback-row"><code className="code">wrangler secret put R2_SECRET_ACCESS_KEY</code></span>
            </li>
            <li>
              Restart this page — <strong>Object storage (R2)</strong> above turns green — then compose a
              post with an image and a video to confirm both upload.
            </li>
          </ol>
        </section>
      )}

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
