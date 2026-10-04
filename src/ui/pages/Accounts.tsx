import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, providerLabel, type Account, type Provider } from '../api';
import { StatusBadge } from '../components/Badge';
import { useToast } from '../components/Toasts';
import { relTime } from '../time';

interface Card {
  provider: Provider;
  label: string;
  blurb: string;
  /** Connect flow: OAuth redirect vs. a small inline form. */
  flow: 'oauth' | 'form' | 'dev';
}

const CARDS: Card[] = [
  {
    provider: 'bluesky',
    label: 'Bluesky',
    blurb: 'Sign in with your handle and an app password.',
    flow: 'form',
  },
  {
    provider: 'facebook',
    label: 'Facebook Pages',
    blurb: 'Publish to a Page you manage. Cotly never posts to personal profiles.',
    flow: 'oauth',
  },
  {
    provider: 'threads',
    label: 'Threads',
    blurb: 'Publish to your Threads account. Posts go live after a short processing step.',
    flow: 'oauth',
  },
  {
    provider: 'linkedin',
    label: 'LinkedIn',
    blurb: 'Share to your LinkedIn profile.',
    flow: 'oauth',
  },
  {
    provider: 'x',
    label: 'X',
    blurb: 'Post to your X account. Publishing is pay-per-post and guarded by a monthly budget.',
    flow: 'oauth',
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

const msg = (e: unknown): string => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export function AccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);

  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [mockName, setMockName] = useState('');

  // Facebook Page chooser, populated only after Meta sends the user back.
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pageBusy, setPageBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await api<Account[]>('/api/accounts'));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) toast('err', msg(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // The OAuth callback redirects back to /accounts?... (routed to /app/accounts
  // with the query intact). Read the result once, toast it, and scrub the URL so
  // a refresh doesn't replay the message.
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

  useEffect(() => { void load(); }, [load]);

  const byProvider = useCallback(
    (p: Provider) => accounts.filter((a) => a.provider === p),
    [accounts],
  );
  const needsReconnect = useMemo(
    () => accounts.filter((a) => a.status === 'needs_reconnect'),
    [accounts],
  );

  const connect = async (card: Card) => {
    setBusy(card.provider);
    try {
      const { url } = await api<{ url: string }>(`/api/oauth/${card.provider}/start`);
      window.location.href = url;
    } catch (e) {
      toast(
        'err',
        e instanceof ApiError && e.status === 400
          ? `${card.label} is not configured yet — finish the Setup Center checklist first.`
          : msg(e),
      );
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
      await load();
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
      await load();
    } catch (e) {
      toast('info', e instanceof ApiError && e.status === 404 ? 'MockSocial is disabled on this deployment.' : msg(e));
    } finally {
      setBusy(null);
    }
  };

  // POST /api/accounts/:id/test -> {ok, detail}. Detail is human-readable and
  // never contains tokens.
  const testConnection = async (a: Account) => {
    const label = `${providerLabel(a.provider)} · ${a.displayName}`;
    setBusy(a.provider);
    try {
      const r = await api<{ ok: boolean; detail: string }>(`/api/accounts/${a.id}/test`, { method: 'POST' });
      if (r.ok) {
        toast('ok', `${label}: ${r.detail}`);
        await load(); // last_verified_at was just refreshed
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
      await load();
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
      await load();
    } catch (e) {
      toast('err', msg(e));
    } finally {
      setPageBusy(null);
    }
  };

  return (
    <div className="accounts">
      <h1>Accounts</h1>
      <p className="hint">
        Connect the places you post to. Tokens are encrypted at rest and never shown here.
      </p>

      {needsReconnect.length > 0 && (
        <div className="banner banner-warn" role="alert">
          <span>
            Reconnect needed:{' '}
            {needsReconnect.map((a) => `${providerLabel(a.provider)} (${a.displayName})`).join(', ')}
          </span>
          <button className="btn btn-sm" onClick={() => void load()}>Refresh</button>
        </div>
      )}

      {pages && (
        <section className="card" role="dialog" aria-label="Choose a Facebook Page">
          <h2>Which Page should Cotly post to?</h2>
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
        </section>
      )}

      {loading && <div className="skeleton" style={{ height: 120 }} />}

      {CARDS.map((card) => {
        const list = byProvider(card.provider);
        return (
          <section key={card.provider} className="card account-card">
            <div className="account-head">
              <div>
                <h2>{card.label}</h2>
                <p className="hint">{card.blurb}</p>
              </div>
              {card.flow === 'oauth' && list.length === 0 && (
                <button
                  className="btn btn-primary"
                  disabled={busy === card.provider}
                  onClick={() => void connect(card)}
                >
                  {busy === card.provider ? 'Opening…' : 'Connect'}
                </button>
              )}
            </div>

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
                  <button className="btn btn-primary" type="submit" disabled={busy === 'bluesky'}>
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
              !loading &&
              card.flow === 'oauth' && <p className="hint">Not connected.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}