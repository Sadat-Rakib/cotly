import { useCallback, useEffect } from 'react';
import { LogoMark } from './Logo';

const ITEMS = [
  { path: '/app/compose', label: 'Compose' },
  { path: '/app/queue', label: 'Queue' },
  { path: '/app/calendar', label: 'Calendar' },
  { path: '/app/accounts', label: 'Accounts' },
  { path: '/app/setup', label: 'Setup' },
  { path: '/app/settings', label: 'Settings' },
];

interface Props {
  path: string;
  email: string;
  onNavigate: (p: string) => void;
  onLogout: () => void;
}

export function Nav({ path, email, onNavigate, onLogout }: Props) {
  const toggleTheme = useCallback(() => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cotly_theme', next); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (!document.documentElement.dataset.theme) document.documentElement.dataset.theme = 'dark';
  }, []);

  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="brand" onClick={() => onNavigate('/app/compose')}>
          <LogoMark className="w-4 h-4" /> Cotly
        </span>
        <div className="nav-links">
          {ITEMS.map((i) => (
            <button
              key={i.path}
              className={`nav-link${path === i.path ? ' active' : ''}`}
              aria-current={path === i.path ? 'page' : undefined}
              onClick={() => onNavigate(i.path)}
            >
              {i.label}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme}>Theme</button>
          <button className="btn btn-ghost btn-sm" onClick={onLogout} title={email}>Log out</button>
        </div>
      </div>
    </nav>
  );
}
