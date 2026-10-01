import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { api, type Me } from './api';
import { Nav } from './components/Nav';
import { AccountsPage } from './pages/Accounts';
import { CalendarPage } from './pages/Calendar';
import { ComposePage } from './pages/Compose';
import { DiagnosticsPage } from './pages/Diagnostics';
import { LoginPage } from './pages/Login';
import { QueuePage } from './pages/Queue';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';

const PROTECTED = new Set(['/compose', '/queue', '/calendar', '/accounts', '/settings', '/diagnostics']);

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((p: string) => {
    if (p !== window.location.pathname) window.history.pushState({}, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    let alive = true;
    api<Me>('/api/me')
      .then((m) => { if (alive) setMe(m); })
      .catch(() => { if (alive) setMe(null); }); // network / 401 -> login
    return () => { alive = false; };
  }, []);

  // Route guards.
  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      if (path !== '/login' && path !== '/setup') navigate('/login');
      return;
    }
    if (!me.isSetup) {
      if (path !== '/setup') navigate('/setup');
      return;
    }
    if (path !== '/' && !PROTECTED.has(path)) navigate('/compose');
    else if (path === '/') navigate('/compose');
  }, [me, path, navigate]);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* session already gone */ }
    setMe(null);
    navigate('/login');
  }, [navigate]);

  if (me === undefined) {
    return <div className="center-screen"><div className="spinner" aria-label="Loading" /></div>;
  }

  const authed = me !== null && me.isSetup;

  let page: ReactElement;
  if (path === '/setup' && (!authed || !me.isSetup)) {
    page = <SetupPage onDone={() => navigate('/compose')} />;
  } else if (path === '/login' && !authed) {
    page = <LoginPage onDone={() => navigate('/compose')} />;
  } else if (authed) {
    switch (path) {
      case '/queue': page = <QueuePage me={me} navigate={navigate} />; break;
      case '/calendar': page = <CalendarPage me={me} />; break;
      case '/accounts': page = <AccountsPage />; break;
      case '/settings': page = <SettingsPage me={me} navigate={navigate} onLogout={logout} />; break;
      case '/diagnostics': page = <DiagnosticsPage me={me} />; break;
      case '/compose': page = <ComposePage me={me} navigate={navigate} />; break;
      default: page = (
        <div className="empty card">
          <p>Page not found.</p>
          <button className="btn btn-primary" onClick={() => navigate('/compose')}>Go to Compose</button>
        </div>
      );
    }
  } else {
    page = <LoginPage onDone={() => navigate('/compose')} />;
  }

  return (
    <div className="app">
      {authed && <Nav path={path} email={me.email} onNavigate={navigate} onLogout={logout} />}
      <main className={authed ? 'main' : 'main main-bare'}>{page}</main>
    </div>
  );
}
