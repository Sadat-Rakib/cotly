import { useState } from 'react';

const KEY = 'cotly_welcome_dismissed';

interface Props {
  navigate: (p: string) => void;
}

// Shown atop Compose until the owner has connected an account (or dismissed it).
export function WelcomePanel({ navigate }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  };

  return (
    <section className="card welcome" role="region" aria-label="Welcome to Cotly">
      <div className="welcome-head">
        <h2>Welcome to Cotly</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>Dismiss</button>
      </div>
      <p className="hint">Five quick steps to your first scheduled post:</p>
      <ol className="welcome-steps">
        <li>
          <button type="button" className="linklike" onClick={() => navigate('/app/setup')}>Check deployment</button>{' '}
          — make sure storage, secrets and the scheduler are green.
        </li>
        <li>
          <button type="button" className="linklike" onClick={() => navigate('/app/accounts')}>Connect your first account</button>.
        </li>
        <li>
          <a href="#compose-media">Upload content</a> below — images or video, in the order you want them.
        </li>
        <li>
          <a href="#compose-review">Preview</a> exactly what will be sent, per platform.
        </li>
        <li>
          <a href="#compose-schedule">Schedule</a> it — or publish right away.
        </li>
      </ol>
    </section>
  );
}
