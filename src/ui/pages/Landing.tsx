interface Props {
  navigate: (p: string) => void;
}

// HONEST status only. Bluesky is the one platform that has been connected and
// published end-to-end; Facebook/Threads ship adapters and await the user's Meta
// app credentials; the rest are not built yet.
const PLATFORMS: Array<{ name: string; note: string; state: 'live' | 'ready' | 'adapter' | 'next' }> = [
  { name: 'Bluesky', note: 'Live verified', state: 'live' },
  { name: 'Facebook Pages', note: 'Ready to connect', state: 'ready' },
  { name: 'Threads', note: 'Ready to connect', state: 'ready' },
  { name: 'LinkedIn', note: 'Adapter ready', state: 'adapter' },
  { name: 'Instagram', note: 'Coming next', state: 'next' },
  { name: 'X', note: 'Coming next', state: 'next' },
  { name: 'Reddit', note: 'Coming next', state: 'next' },
  { name: 'TikTok', note: 'Coming next', state: 'next' },
];

const STATE_TEXT: Record<string, string> = {
  live: 'Connected and published end-to-end.',
  ready: 'Publisher built. Add your Meta app credentials in Cotly, then connect.',
  adapter: 'Publisher built. Waiting on your LinkedIn app credentials.',
  next: 'Not built yet.',
};

const STEPS = [
  {
    num: '01',
    title: 'Add your content',
    body: 'Upload image/video and paste your caption.',
  },
  {
    num: '02',
    title: 'Choose your accounts',
    body: 'Pick the platforms where it should go.',
  },
  {
    num: '03',
    title: 'Schedule and leave',
    body: 'Cotly handles the timing in the cloud.',
  },
];

/** Engraved-feel ornament: stroke-only sprig with hatching. Decorative only. */
function Sprig() {
  return (
    <svg className="sprig" viewBox="0 0 120 48" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 40 C 26 40, 40 22, 62 22 C 82 22, 96 34, 118 34" stroke="currentColor" strokeWidth="1" />
      <path d="M62 22 C 62 14, 58 10, 52 6" stroke="currentColor" strokeWidth="1" />
      <path d="M62 22 C 66 13, 72 8, 80 4" stroke="currentColor" strokeWidth="1" />
      <path d="M30 33 C 34 26, 40 22, 48 20" stroke="currentColor" strokeWidth="0.75" />
      <path d="M34 37 C 38 31, 42 28, 48 27" stroke="currentColor" strokeWidth="0.5" />
      <path d="M84 30 C 88 25, 94 22, 100 21" stroke="currentColor" strokeWidth="0.75" />
      <path d="M88 34 C 92 30, 96 28, 101 27" stroke="currentColor" strokeWidth="0.5" />
      <circle cx="2" cy="40" r="1.5" fill="currentColor" />
      <circle cx="118" cy="34" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Thin rule with a centred mark, used to separate editorial blocks. */
function Rule() {
  return (
    <svg className="rule" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 6 H190 M210 6 H400" stroke="currentColor" strokeWidth="1" />
      <path d="M198 6 L200 2 L202 6 L200 10 Z" fill="currentColor" />
    </svg>
  );
}

export function Landing({ navigate }: Props) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <header className="landing-header">
          <span className="landing-brand">cotly</span>
          <nav className="landing-nav" aria-label="Landing">
            <a className="landing-navlink" href="#how-it-works">How it works</a>
            <a className="landing-navlink" href="#platforms">Platforms</a>
            <button type="button" className="landing-navlink landing-signin" onClick={() => navigate('/login')}>Sign in</button>
          </nav>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/app')}>Open Cotly</button>
        </header>

        <section className="landing-hero">
          <span className="landing-eyebrow">Social scheduling, minus the babysitting</span>
          <h1 className="landing-title">Post once.<br />Get on with your day.</h1>
          <p className="landing-sub">
            Upload your content, connect your accounts, choose when it should go live, and Cotly
            handles the schedule.
          </p>
          <div className="landing-cta-row">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/app')}>Open Cotly</button>
            <button type="button" className="btn btn-lg" onClick={() => navigate('/app/accounts')}>Connect accounts</button>
          </div>

          {/* Tasteful preview of the real product — static, honest, no fake analytics. */}
          <div className="landing-mock" aria-hidden="true">
            <div className="landing-mock-frame">
              <div className="landing-mock-bar">
                <span className="landing-mock-dot" />
                <span className="landing-mock-dot" />
                <span className="landing-mock-dot" />
                <span className="landing-mock-title">Compose</span>
              </div>
              <div className="landing-mock-body">
                <div className="card landing-mock-card">
                  <span className="mock-kicker">Your post</span>
                  <div className="mock-media-row">
                    <div className="thumb"><span className="thumb-file">img</span></div>
                    <div className="thumb"><span className="thumb-file">img</span></div>
                    <div className="thumb"><span className="thumb-file">video</span></div>
                  </div>
                  <p className="mock-caption">&ldquo;Autumn collection drops Friday — behind the scenes thread below.&rdquo;</p>
                  <div className="chips">
                    <span className="chip chip-neutral">Bluesky · 92/300</span>
                    <span className="chip chip-neutral">Threads · 92/500</span>
                  </div>
                </div>
                <div className="card landing-mock-card">
                  <div className="qitem-top">
                    <span className="qtime">Tomorrow, 9:00 AM</span>
                    <span className="badge badge-scheduled">scheduled</span>
                  </div>
                  <p className="qcaption">Autumn collection drops Friday…</p>
                  <div className="chips">
                    <span className="chip chip-scheduled">Bluesky · scheduled</span>
                    <span className="chip chip-scheduled">Threads · scheduled</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="how-it-works">
          <Rule />
          <h2 className="landing-h2">How it works</h2>
          <div className="landing-steps">
            {STEPS.map((s) => (
              <div key={s.num} className="landing-step">
                <span className="landing-step-num">{s.num}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" id="platforms">
          <Rule />
          <h2 className="landing-h2">Platforms</h2>
          <p className="landing-section-sub">
            Where each one actually stands, stated plainly.
          </p>
          <ul className="platform-table">
            {PLATFORMS.map((p) => (
              <li key={p.name} className={`platform-row platform-${p.state}`}>
                <span className="platform-name">{p.name}</span>
                <span className={`plat-badge plat-${p.state}`}>{p.note}</span>
                <span className="platform-blurb">{STATE_TEXT[p.state]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-final">
          <Sprig />
          <h2 className="landing-title-sm">Your content. Your schedule. No babysitting posts.</h2>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/app')}>Open Cotly</button>
        </section>

        <footer className="landing-footer">
          <div className="landing-footer-brand">
            <span className="landing-brand">cotly</span>
            <span className="landing-footer-tag">Post once. Get on with your day.</span>
          </div>
          <nav className="landing-footer-links" aria-label="Footer">
            <a href="#how-it-works">How it works</a>
            <a href="#platforms">Platforms</a>
            <a href="/login">Sign in</a>
            <a href="/setup">First-time setup</a>
          </nav>
          <span className="landing-footer-note">Cotly is an independent scheduler. Not affiliated with any platform listed above.</span>
        </footer>
      </div>
    </div>
  );
}