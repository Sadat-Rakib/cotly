interface Props {
  navigate: (p: string) => void;
}

// HONEST status badges — nothing is live-verified yet, so nothing may claim
// "Ready" or "Live". Wording is contract-fixed.
const PLATFORMS: Array<{ name: string; badge: string; tone: 'ready' | 'soon' | 'optional' | 'planned' }> = [
  { name: 'Facebook', badge: 'Code ready', tone: 'ready' },
  { name: 'Threads', badge: 'Code ready', tone: 'ready' },
  { name: 'LinkedIn', badge: 'Code ready', tone: 'ready' },
  { name: 'Bluesky', badge: 'Code ready', tone: 'ready' },
  { name: 'Instagram', badge: 'Coming next', tone: 'soon' },
  { name: 'X (Twitter)', badge: 'Optional — paid API', tone: 'optional' },
  { name: 'Reddit', badge: 'Planned', tone: 'planned' },
  { name: 'TikTok', badge: 'Planned', tone: 'planned' },
];

const STEPS = [
  {
    num: '01',
    title: 'Add your content',
    body: 'Drop in images or video, write the caption once, and tailor per-platform overrides where it matters.',
  },
  {
    num: '02',
    title: 'Choose where and when',
    body: 'Pick the destinations, publish immediately, set an exact time, or spread posts evenly across the day.',
  },
  {
    num: '03',
    title: 'Cotly publishes it',
    body: 'The scheduler posts on time and shows you exactly what went out, where, and when it landed.',
  },
];

export function Landing({ navigate }: Props) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <header className="landing-header">
          <span className="landing-brand">Cotly</span>
          <nav className="landing-nav" aria-label="Landing">
            <a className="landing-navlink" href="#how-it-works">How it works</a>
            <a className="landing-navlink" href="#platforms">Platforms</a>
            <button type="button" className="landing-navlink landing-signin" onClick={() => navigate('/login')}>Sign in</button>
          </nav>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/app')}>Open Cotly</button>
        </header>

        <section className="landing-hero">
          <h1 className="landing-title">Schedule your content.<br />Cotly handles the posting.</h1>
          <p className="landing-sub">
            Write once, pick the accounts and the exact times, and let Cotly&rsquo;s scheduler
            do the posting while you get on with your day.
          </p>
          <div className="landing-cta-row">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/app/compose')}>Start scheduling</button>
            <a className="btn btn-lg" href="#platforms">View supported platforms</a>
          </div>

          {/* Static product mock — real design tokens, no fake analytics. */}
          <div className="landing-mock" aria-hidden="true">
            <div className="card landing-mock-card">
              <span className="mock-kicker">Compose</span>
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
              <div className="mock-actions">
                <span className="btn btn-primary">Review &amp; publish</span>
                <span className="btn">Schedule</span>
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
        </section>

        <section className="landing-section" id="how-it-works">
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
          <h2 className="landing-h2">Supported platforms</h2>
          <p className="landing-section-sub">
            Honest status only — &ldquo;Code ready&rdquo; means the publisher is built and waiting on platform
            app review, not that it has been live-verified yet.
          </p>
          <div className="platform-grid">
            {PLATFORMS.map((p) => (
              <div key={p.name} className="platform-card">
                <span className="platform-name">{p.name}</span>
                <span className={`plat-badge plat-${p.tone}`}>{p.badge}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-final">
          <h2 className="landing-title-sm">Stop babysitting your posting schedule.</h2>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/app')}>Open Cotly</button>
        </section>

        <footer className="landing-footer">
          <span className="landing-brand">Cotly</span>
          <span className="landing-footer-sep">·</span>
          <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
          <span className="landing-footer-sep">·</span>
          <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </div>
    </div>
  );
}
