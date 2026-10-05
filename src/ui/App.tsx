import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { api, type Me } from './api';
import { Sidebar } from './components/Sidebar';
import { CalendarPage } from './pages/Calendar';
import { ComposePage } from './pages/Compose';
import { Landing } from './pages/Landing';
import { LoginPage } from './pages/Login';
import { ProfilePage } from './pages/Profile';
import { QueuePage } from './pages/Queue';
import { SetupPage } from './pages/Setup';
import { SignupPage } from './pages/Signup';
import { TermsPage } from './pages/Terms';
import { ServicesPage } from './pages/Services';
import { PrivacyPage } from './pages/Privacy';
import { DataDeletionPage } from './pages/DataDeletion';

const APP_ROUTES = new Set(['/app/compose', '/app/queue', '/app/calendar', '/app/profile']);

const PUBLIC_ROUTES = new Set(['/', '/login', '/signup', '/terms', '/services', '/privacy', '/data-deletion', '/setup']);

// Pre-v0.2 links (e.g. OAuth callbacks redirecting to /accounts?connected=1)
// and pre-consolidation routes all land on their /app equivalents, query
// string preserved. Setup/Settings/Diagnostics/Accounts now live in Profile.
const LEGACY_ALIASES: Record<string, string> = {
  '/compose': '/app/compose',
  '/queue': '/app/queue',
  '/calendar': '/app/calendar',
  '/accounts': '/app/profile',
  '/settings': '/app/profile',
  '/diagnostics': '/app/profile',
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

  // Route guards. Public routes (landing, legal pages, auth, first-run setup)
  // are never redirected away.
  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      if (!PUBLIC_ROUTES.has(path)) navigate('/login');
      return;
    }
    if (!me.isSetup) {
      if (path !== '/setup') navigate('/setup');
      return;
    }
    const query = window.location.search;
    if (path === '/login' || path === '/signup' || path === '/setup' || path === '/app') navigate('/app/compose');
    else if (LEGACY_ALIASES[path]) navigate(`${LEGACY_ALIASES[path]}${query}`);
    else if (!PUBLIC_ROUTES.has(path) && !APP_ROUTES.has(path)) navigate('/');
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
    ? !PUBLIC_ROUTES.has(path)
    : !me.isSetup
      ? path !== '/setup'
      : path === '/login' || path === '/signup' || path === '/setup' || path === '/app'
        || (!PUBLIC_ROUTES.has(path) && !knownAppRoute && !LEGACY_ALIASES[path]);

  if (waiting) return LOADING;

  let page: ReactElement;
  if (path === '/') {
    page = <Landing navigate={navigate} authed={authed} />;
  } else if (path === '/terms') {
    page = <TermsPage />;
  } else if (path === '/services') {
    page = <ServicesPage />;
  } else if (path === '/privacy') {
    page = <PrivacyPage />;
  } else if (path === '/data-deletion') {
    page = <DataDeletionPage />;
  } else if (path === '/login') {
    page = <LoginPage onDone={() => { refreshMe(); navigate('/app/compose'); }} onNav={navigate} />;
  } else if (path === '/signup' && !authed) {
    page = <SignupPage onDone={() => { refreshMe(); navigate('/app/compose'); }} onNav={navigate} />;
  } else if (path === '/setup' && (!authed || !me.isSetup)) {
    page = <SetupPage onDone={() => { refreshMe(); navigate('/app/compose'); }} />;
  } else if (authed && knownAppRoute) {
    switch (path) {
      case '/app/queue': page = <QueuePage me={me} navigate={navigate} />; break;
      case '/app/calendar': page = <CalendarPage me={me} />; break;
      case '/app/profile': page = <ProfilePage me={me} onLogout={logout} />; break;
      case '/app/compose': page = <ComposePage me={me} navigate={navigate} />; break;
      default: page = LOADING;
    }
  } else {
    page = LOADING;
  }

  const isPublic = path === '/' || path === '/terms' || path === '/services' || path === '/privacy' || path === '/data-deletion';
  const isAuth = path === '/login' || path === '/signup';

  return (
    <div className={authed && knownAppRoute ? 'app app-shell' : 'app'}>
      {authed && knownAppRoute && <Sidebar path={path} email={me.email} onNavigate={navigate} onLogout={logout} />}
      <main className={isPublic ? 'main main-landing' : isAuth ? 'main main-auth' : authed && knownAppRoute ? 'main main-app' : 'main main-bare'}>
        {page}
      </main>
    </div>
  );
}
