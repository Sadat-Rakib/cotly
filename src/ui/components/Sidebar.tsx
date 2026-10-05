import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ListChecks, LogOut, Menu, PanelLeftClose, PanelLeftOpen, PenSquare, X, CircleUserRound } from 'lucide-react';
import { LogoMark } from './Logo';

const ITEMS = [
  { path: '/app/compose', label: 'Compose', icon: PenSquare },
  { path: '/app/queue', label: 'Queue', icon: ListChecks },
  { path: '/app/calendar', label: 'Calendar', icon: CalendarDays },
  { path: '/app/profile', label: 'Profile', icon: CircleUserRound },
];

const COLLAPSE_KEY = 'cotly_sidebar_collapsed';

interface Props {
  path: string;
  email: string;
  onNavigate: (p: string) => void;
  onLogout: () => void;
}

// Collapsible left sidebar — the single navigation surface for the app.
// Desktop: fixed rail with a collapse toggle (state persisted). Mobile: a
// top bar with a hamburger that opens the same items as a slide-in drawer.
export function Sidebar({ path, email, onNavigate, onLogout }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [path]);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const toggleCollapse = useCallback(() => setCollapsed((v) => !v), []);
  const go = (p: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDrawerOpen(false);
    onNavigate(p);
  };

  const navItems = (showLabels: boolean, compact = false) =>
    ITEMS.map(({ path: itemPath, label, icon: Icon }) => {
      const active = path === itemPath || path.startsWith(`${itemPath}/`);
      return (
        <a
          key={itemPath}
          href={itemPath}
          onClick={go(itemPath)}
          title={collapsed && !compact ? label : undefined}
          aria-current={active ? 'page' : undefined}
          className={`sb-item${active ? ' active' : ''}${showLabels ? '' : ' icons-only'}`}
        >
          <Icon className="sb-icon" aria-hidden="true" />
          {showLabels && <span className="sb-label">{label}</span>}
        </a>
      );
    });

  return (
    <>
      {/* Mobile top bar */}
      <header className="sb-topbar">
        <button type="button" className="sb-burger" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <a href="/app/compose" onClick={go('/app/compose')} className="sb-brand">
          <LogoMark className="w-5 h-5" /> Cotly
        </a>
        <span className="sb-topbar-spacer" aria-hidden="true" />
      </header>

      {/* Mobile drawer + overlay */}
      {drawerOpen && <div className="sb-overlay" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <aside className={`sb-drawer${drawerOpen ? ' open' : ''}`} aria-hidden={!drawerOpen}>
        <div className="sb-drawer-head">
          <span className="sb-brand"><LogoMark className="w-5 h-5" /> Cotly</span>
          <button type="button" className="sb-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <nav className="sb-nav">{navItems(true, true)}</nav>
        <button type="button" className="sb-item sb-logout" onClick={onLogout}>
          <LogOut className="sb-icon" aria-hidden="true" />
          <span className="sb-label">Log out</span>
        </button>
      </aside>

      {/* Desktop rail */}
      <aside className={`sb-rail${collapsed ? ' collapsed' : ''}`}>
        <div className="sb-head">
          <span className="sb-brand"><LogoMark className="w-5 h-5" />{!collapsed && ' Cotly'}</span>
          <button
            type="button"
            className="sb-collapse"
            onClick={toggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" aria-hidden="true" /> : <PanelLeftClose className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
        <nav className="sb-nav">{navItems(!collapsed)}</nav>
        <div className="sb-foot">
          {!collapsed && <span className="sb-email" title={email}>{email}</span>}
          <button
            type="button"
            className="sb-item sb-logout"
            onClick={onLogout}
            title="Log out"
          >
            <LogOut className="sb-icon" aria-hidden="true" />
            {!collapsed && <span className="sb-label">Log out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
