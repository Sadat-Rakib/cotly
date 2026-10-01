import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, providerLabel, type Account, type Provider } from '../api';
import { StatusBadge } from '../components/Badge';
import { useToast } from '../components/Toasts';

interface Card {
  provider: Provider;
  label: string;
  oauth: boolean;
  blurb: string;
}

const CARDS: Card[] = [
  { provider: 'facebook', label: 'Facebook', oauth: true, blurb: 'Publish to a Facebook Page you manage.' },
  { provider: 'threads', label: 'Threads', oauth: true, blurb: 'Threads posts go live after a short processing step.' },
  { provider: 'linkedin', label: 'LinkedIn', oauth: true, blurb: 'Share to your LinkedIn profile.' },
  { provider: 'bluesky', label: 'Bluesky', oauth: false, blurb: 'Connect with your handle and an app password.' },
  { provider: 'mock', label: 'MockSocial', oauth: false, blurb: 'Built-in test provider for fault injection.' },
];

export function AccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');
  const [mockName, setMockName] = useState('');
  const [bskyBusy, setBskyBusy] = useState(false);
  const [mockBusy, setMockBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await api<Account[]>('/api/accounts'));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) toast('err', e.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const byProvider = useCallback((p: Provider) => accounts.filter((a) => a.provider === p), [accounts]);
  const needsReconnect = accounts.filter((a) => a.status === 'needs_reconnect');

  const connect = async (card: Card) => {
    try {
      const { url } = await api<{ url: string }>(`/api/oauth/${card.provider}/start`);
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Could not start OAuth';
      toast('err', e instanceof ApiError && e.status === 400 ? `${card.label} not configured — see Settings/docs` : msg);
    }
  };

  const connectBsky = async () => {
    setBskyBusy(true);
    try {
      await api('/api/accounts/bluesky', { method: 'POST', body: { handle: bskyHandle, appPassword: bskyPassword } });
      toast('ok', 'Bluesky connected');
      setBskyHandle('');
      setBskyPassword('');
      await load();
    } catch (e) {
      toast('err', e instanceof ApiError ? e.message : 'Could not connect Bluesky');
    } finally {
      setBskyBusy(false);
    }
  };

  const connectMock = async () => {
    setMockBusy(true);
    try {
      await api('/api/accounts/mock', { method: 'POST', body: { displayName: mockName || 'Mock account' } });
      toast('ok', 'MockSocial account added');
      setMockName('');
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Could not add MockSocial account';
      toast('info', e instanceof ApiError && e.status === 404 ? 'MockSocial is not enabled (set MOCK_SOCIAL_ENABLED=true)' : msg);
    } finally {
      setMockBusy(false);
    }
  };

  const disconnect = async (a: Account) => {
    if (!window.confirm(`Disconnect ${a.displayName} (${providerLabel(a.provider)})?`)) return;
    try {
      await api(`/api/accounts/${a.id}`, { method: 'DELETE' });
      toast('ok', 'Account disconnected');
      await load();
    } catch (e) {
      toast('err', e instanceof ApiError ? e.message : 'Could not disconnect');
    }
  };

  return (
    <div className="accounts">
      <h1>Accounts</h1>

      {needsReconnect.length > 0 && (
        <div className="banner banner-warn" role="alert">
          Reconnect: {needsReconnect.map((a) => `${providerLabel(a.provider)} (${a.displayName})`).join(', ')}
        </div>
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
              {card.oauth && (
                <button className="btn btn-primary" onClick={() => void connect(card)}>Connect {card.label}</button>
              )}
            </div>

            {card.provider === 'bluesky' && (
              <form
                className="inline-form"
                onSubmit={(e) => { e.preventDefault(); void connectBsky(); }}
              >
                <input className="input" placeholder="handle.bsky.social" value={bskyHandle}
                  onChange={(e) => setBskyHandle(e.target.value)} required aria-label="Bluesky handle" />
                <input className="input" type="password" placeholder="App password" value={bskyPassword}
                  onChange={(e) => setBskyPassword(e.target.value)} required aria-label="Bluesky app password" />
                <button className="btn btn-primary" type="submit" disabled={bskyBusy}>
                  {bskyBusy ? 'Connecting…' : 'Connect'}
                </button>
              </form>
            )}
            {card.provider === 'bluesky' && (
              <p className="hint">Create an app password at bsky.app/settings/app-passwords.</p>
            )}

            {card.provider === 'mock' && (
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void connectMock(); }}>
                <input className="input" placeholder="Display name" value={mockName}
                  onChange={(e) => setMockName(e.target.value)} aria-label="MockSocial display name" />
                <button className="btn btn-primary" type="submit" disabled={mockBusy}>
                  {mockBusy ? 'Adding…' : 'Add'}
                </button>
              </form>
            )}

            {list.length > 0 && (
              <ul className="account-list">
                {list.map((a) => (
                  <li key={a.id} className="account-row">
                    <div className="account-info">
                      <span className="dest-name">{a.displayName}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => void disconnect(a)}>Disconnect</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
