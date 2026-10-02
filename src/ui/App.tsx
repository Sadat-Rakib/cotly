import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { api, type Me } from './api';
import { Nav } from './components/Nav';
import { AccountsPage } from './pages/Accounts';
import { CalendarPage } from './pages/Calendar';
import { ComposePage } from './pages/Compose';
import { DiagnosticsPage } from './pages/Diagnostics';
import { Landing } from './pages/Landing';
import { LoginPage } from './pages/Login';
import { QueuePage } from './pages/Queue';
import { SettingsPage } from './pages/Settings';
import { SetupCenterPage } from './pages/SetupCenter';
import { SetupPage } from './pages/Setup';

const APP_ROUTES = new Set([
  '/app/compose', '/app/queue', '/app/calendar', '/app/accounts', '/app/settings', '/app/diagnostics', '/app/setup',
]);

// Pre-v0.2 links (e.g. OAuth callbacks redirecting to /accounts?connected=1)
// land on their /app equivalents, query string preserved.
const LEGACY_ALIASES: Record<string, string> = {
  '/compose': '/app/compose',
  '/queue': '/app/queue',
  '/calendar': '/app/calendar',
  '/accounts': '/app/accounts',
  '/settings': '/app/settings',
  '/diagnostics': '/app/diagnostics',
};

const LOADING = <div className="center-screen"><div className="spinner" aria-label="Loading" /></div>;

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((p: string) => {
    const [pathname, search] = p.split('?');
    const next = pathname ?? p;
    if (next !== window.location.pathname || (search ?? '') !== window.location.search.replace(/^\?/, '')) {
      window.history.pushState({}, '', p);
    }
    setPath(next);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    let alive = true;
    api<Me>('/api/me')
      .then((m) => { if (alive) setMe(m); })
      .catch(() => { if (alive) setMe(null); }); // network / 401 -> logged out
    return () => { alive = false; };
  }, []);

  // Route guards. '/' is the public landing page and is never redirected.
  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      if (path !== '/' && path !== '/login' && path !== '/setup') navigate('/login');
      return;
    }
    if (!me.isSetup) {
      if (path !== '/setup') navigate('/setup');
      return;
    }
    const query = window.location.search;
    if (path === '/login' || path === '/setup' || path === '/app') navigate('/app/compose');
    else if (LEGACY_ALIASES[path]) navigate(`${LEGACY_ALIASES[path]}${query}`);
    else if (path !== '/' && !APP_ROUTES.has(path)) navigate('/');
  }, [me, path, navigate]);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* session already gone */ }
    setMe(null);
    navigate('/login');
  }, [navigate]);

  // Login/setup only set a session cookie — /api/me must be refetched or the
  // guard below still sees the logged-out state and bounces back to /login.
  const refreshMe = useCallback(() => {
    api<Me>('/api/me')
      .then((m) => setMe(m))
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return LOADING;

  const authed = me !== null && me.isSetup;
  const knownAppRoute = APP_ROUTES.has(path);

  // States the guard is about to redirect away from render as loading, never
  // as their (unauthorized) page.
  const waiting = me === null
    ? path !== '/' && path !== '/login' && path !== '/setup'
    : !me.isSetup
      ? path !== '/setup'
      : path === '/login' || path === '/setup' || path === '/app'
        || (!knownAppRoute && path !== '/' && !LEGACY_ALIASES[path]);

  if (waiting) return LOADING;

  let page: ReactElement;
  if (path === '/') {
    page = <Landing navigate={navigate} />;
  } else if (path === '/login') {
    page = <LoginPage onDone={() => { refreshMe(); navigate('/app/compose'); }} />;
  } else if (path === '/setup' && (!authed || !me.isSetup)) {
    page = <SetupPage onDone={() => { refreshMe(); navigate('/app/compose'); }} />;
  } else if (authed && knownAppRoute) {
    switch (path) {
      case '/app/queue': page = <QueuePage me={me} navigate={navigate} />; break;
      case '/app/calendar': page = <CalendarPage me={me} />; break;
      case '/app/accounts': page = <AccountsPage />; break;
      case '/app/settings': page = <SettingsPage me={me} navigate={navigate} onLogout={logout} />; break;
      case '/app/diagnostics': page = <DiagnosticsPage me={me} />; break;
      case '/app/setup': page = <SetupCenterPage me={me} navigate={navigate} />; break;
      case '/app/compose': page = <ComposePage me={me} navigate={navigate} />; break;
      default: page = LOADING;
    }
  } else {
    page = LOADING;
  }

  return (
    <div className="app">
      {authed && <Nav path={path} email={me.email} onNavigate={navigate} onLogout={logout} />}
      <main className={authed ? 'main' : 'main main-bare'}>{page}</main>
    </div>
  );
}
