import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Logo, LogoMark } from '../components/Logo';

// lucide-react v1 dropped brand icons, so the badge carries its own tiny marks.
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.9 3H21l-6.8 7.8L22.2 21h-6.3l-4.9-6.4L5.4 21H2.2l7.3-8.3L2 3h6.4l4.4 5.9L17.9 3zm-1.1 16.1h1.7L7.6 4.8H5.8l11 14.3z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.9" cy="7.1" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.6 3c.4 2.1 1.8 3.6 3.9 3.9v3c-1.5 0-2.9-.5-3.9-1.3v5.9c0 3.4-2.6 5.9-5.9 5.9A5.87 5.87 0 0 1 4.8 14.6c0-3.3 2.7-6 6.1-5.9v3.1c-1.6-.2-3 .9-3.1 2.5-.1 1.5 1 2.8 2.5 2.9h.3c1.5 0 2.8-1.2 2.8-2.8V3h3.2z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12c0 1.6.1 3.2.4 4.8a2.8 2.8 0 0 0 2 2c1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4a2.8 2.8 0 0 0 2-2c.3-1.6.4-3.2.4-4.8s-.1-3.2-.4-4.8zM10 15.2V8.8L15.5 12 10 15.2z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3V9zm6 0h3.8v1.7h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.5c0-1.3 0-3-1.9-3-1.9 0-2.2 1.4-2.2 2.9V21H9V9z" />
    </svg>
  );
}

// Tiny colored chips for the badge, mirroring the concept render.
const BADGE_PLATFORMS = [
  { label: 'X', icon: XIcon, className: 'bg-[#0f1419] text-white' },
  { label: 'Instagram', icon: InstagramIcon, className: 'bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white' },
  { label: 'TikTok', icon: TikTokIcon, className: 'bg-[#0f1419] text-white' },
  { label: 'YouTube', icon: YouTubeIcon, className: 'bg-[#ff0000] text-white' },
  { label: 'LinkedIn', icon: LinkedInIcon, className: 'bg-[#0a66c2] text-white' },
];

interface Props {
  navigate: (p: string) => void;
  authed: boolean;
}

// Demo rows for the scheduling showcase. These demonstrate the product; they
// are not testimonials and name no customers.
const QUEUE_ROWS = [
  {
    post: 'Product launch',
    caption: '"We\'ve been building something new. It\'s finally ready."',
    platforms: ['X', 'Threads', 'LinkedIn'],
    date: 'Oct 4',
    time: '9:30 AM',
    status: 'Scheduled' as const,
  },
  {
    post: 'Behind the scenes',
    caption: '"A quick look at what went into this week\'s release."',
    platforms: ['Instagram', 'Threads'],
    date: 'Oct 4',
    time: '1:00 PM',
    status: 'Scheduled' as const,
  },
  {
    post: 'Launch walkthrough',
    caption: '"Here\'s the full walkthrough."',
    platforms: ['YouTube', 'TikTok'],
    date: 'Oct 5',
    time: '10:00 AM',
    status: 'Preparing' as const,
  },
  {
    post: 'Weekend update',
    caption: '"Everything we shipped this week."',
    platforms: ['X', 'Bluesky', 'Mastodon'],
    date: 'Oct 5',
    time: '4:30 PM',
    status: 'Scheduled' as const,
  },
];

const STEPS = [
  { num: '01', title: 'Add your content', body: 'Write your caption and upload your image or video.' },
  { num: '02', title: 'Choose your accounts', body: 'Select exactly where Cotly should publish it.' },
  { num: '03', title: 'Choose the time', body: 'Publish now or schedule it for later.' },
];

const EASE = [0.16, 1, 0.3, 1] as const;

const rise = (delay = 0, y = 16) => ({
  initial: { opacity: 0, y },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.7, ease: EASE, delay },
});

// One huge faded phrase drifting across the sky. Two copies per track make the
// -50% translate loop seamless; the row is decorative and hidden from a11y.
// With `half`, the track anchors to one side so a pair can flank the hero
// visual from opposite edges (POST ONCE. | GET ON WITH YOUR DAY.).
function GhostWords({
  phrase,
  side,
  size,
  half = false,
}: {
  phrase: string;
  side: 'left' | 'right';
  size: string;
  half?: boolean;
}) {
  return (
    <div
      className={`ghost-words ghost-${side} ${size} ${half ? `ghost-half-${side}` : ''}`}
      aria-hidden="true"
    >
      <div className="ghost-track">
        {[0, 1].map((i) => (
          <span key={i} className="ghost-word">
            {phrase}
          </span>
        ))}
      </div>
    </div>
  );
}

// Clouds and soft 3D orbs rendered as pure CSS — no image assets, always crisp.
function SkyScene() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="sky-cloud w-[420px] h-[180px] top-[6%] left-[4%] opacity-80" />
      <div className="sky-cloud w-[340px] h-[150px] top-[16%] right-[6%] opacity-70" />
      <div className="sky-cloud w-[520px] h-[220px] top-[42%] left-[-6%] opacity-60" />
      <div className="sky-cloud w-[380px] h-[170px] top-[64%] right-[10%] opacity-50" />
      <div className="sky-cloud w-[460px] h-[200px] top-[86%] left-[24%] opacity-60" />
      <div className="sky-orb w-16 h-16 top-[12%] left-[16%] sky-float" />
      <div className="sky-orb sky-orb-rose w-10 h-10 top-[30%] right-[18%] sky-float-slow" />
      <div className="sky-orb w-7 h-7 top-[58%] left-[8%] sky-float-slow" />
      <div className="sky-orb sky-orb-rose w-12 h-12 top-[78%] right-[8%] sky-float" />
    </div>
  );
}

// The hero centerpiece: a generated 3D scene (projector device + holographic
// compose screen) as a feathered WebP cutout floating on the coded sky. The
// huge faded words flank it from opposite edges, drifting in opposite
// directions; the handwritten note is coded text, not baked pixels.
function HeroVisual() {
  return (
    <div className="relative max-w-4xl mx-auto px-4">
      <div className="absolute inset-x-0 -top-10 md:-top-16" aria-hidden="true">
        <GhostWords phrase="POST ONCE." side="left" half size="text-[15vw] md:text-[9rem]" />
        <GhostWords phrase="GET ON WITH YOUR DAY." side="right" half size="text-[8vw] md:text-[4.6rem] top-6 md:top-10" />
      </div>

      <motion.img
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.45 }}
        src="/brand/hero-device.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="relative z-10 w-full h-auto select-none sky-float-slow hero-glow"
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE, delay: 1 }}
        aria-hidden="true"
        className="hidden lg:block absolute z-10 right-[-2.5rem] top-[38%] -rotate-6 text-right"
      >
        <p className="font-hand text-[#4a44c9] text-2xl leading-tight drop-shadow-[0_2px_6px_rgba(255,255,255,0.55)]">
          Write once.
          <br />
          Publish everywhere.
        </p>
        <svg viewBox="0 0 60 40" className="w-10 h-7 ml-auto mr-6 mt-1 text-[#4a44c9]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 4 C 18 26, 34 30, 50 22" />
          <path d="M42 20 l 9 2 -4 8" />
        </svg>
      </motion.div>
    </div>
  );
}

export function Landing({ navigate, authed }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const cta = { label: 'Start posting', href: authed ? '/app/compose' : '/signup' };

  const goto = (p: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    navigate(p);
  };

  const jump = (hash: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    document.querySelector(hash)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const navLinks = [
    { label: 'Home', href: '#top', onClick: jump('#top') },
    { label: 'How it works', href: '#how-it-works', onClick: jump('#how-it-works') },
    { label: 'Schedule', href: '#queue', onClick: jump('#queue') },
    { label: 'Start posting', href: cta.href, onClick: goto(cta.href), cta: true },
  ];

  return (
    <div className="cotly-sky min-h-[100dvh] text-[#1e1b4b] antialiased" id="top">
      {/* ================= Navbar ================= */}
      <header
        className={`fixed top-0 left-0 w-full z-50 transition-all duration-500 ${
          scrolled ? 'bg-white/25 backdrop-blur-xl border-b border-white/40' : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-28 flex items-center justify-between h-16 md:py-5 md:h-auto">
          <a href="/" onClick={goto('/')} className="no-underline text-[#1e1b4b]">
            <Logo markClass="w-6 h-6" wordClass="text-xl font-semibold tracking-tight" />
          </a>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.slice(0, 3).map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={l.onClick}
                className="no-underline text-sm font-medium text-[#1e1b4b]/60 hover:text-[#1e1b4b] transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <motion.a
              href={cta.href}
              onClick={goto(cta.href)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="hidden md:inline-flex md:items-center md:gap-1.5 no-underline bg-white text-[#1e1b4b] text-sm font-semibold rounded-full px-5 py-2 shadow-lg shadow-[#5b6cf5]/25 hover:bg-white/90 transition-colors"
            >
              {cta.label}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </motion.a>
            <button
              type="button"
              aria-label="Toggle menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden w-9 h-9 flex flex-col items-center justify-center gap-1.5"
            >
              <span className="sr-only">Menu</span>
              <span
                className="w-6 h-[2px] bg-[#1e1b4b] transition-transform duration-500"
                style={{ transform: menuOpen ? 'translateY(4px) rotate(45deg)' : 'none' }}
              />
              <span
                className="w-6 h-[2px] bg-[#1e1b4b] transition-transform duration-500"
                style={{ transform: menuOpen ? 'translateY(-4px) rotate(-45deg)' : 'none' }}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ================= Mobile menu ================= */}
      <div
        className={`fixed inset-0 z-40 cotly-sky flex flex-col items-center justify-center gap-8 transition-all duration-500 ${
          menuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
      >
        {navLinks.map((l) => (
          <a
            key={l.label}
            href={l.href}
            onClick={l.onClick}
            className={`font-instrument no-underline text-[#1e1b4b] text-4xl hover:opacity-60 ${
              l.cta ? 'text-2xl mt-4 bg-white rounded-full px-8 py-3 shadow-xl' : ''
            }`}
          >
            {l.label}
          </a>
        ))}
      </div>

        {/* ================= Hero ================= */}
        <section className="relative w-full overflow-hidden pt-32 md:pt-40 pb-20 md:pb-24">
          <SkyScene />

          <div className="relative text-center px-6 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="inline-flex items-center gap-2.5 liquid-glass rounded-full pl-3 pr-4 py-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-white/90" aria-hidden="true" />
              <span className="text-white text-sm font-medium drop-shadow">20+ platforms supported</span>
              <span className="flex items-center gap-1 ml-0.5">
                {BADGE_PLATFORMS.map(({ label, icon: Icon, className }) => (
                  <span
                    key={label}
                    title={label}
                    className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full ${className} shadow-sm ring-1 ring-white/30`}
                  >
                    <Icon className="w-[11px] h-[11px]" />
                  </span>
                ))}
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
              className="font-instrument text-white text-6xl md:text-8xl leading-[0.95] mt-8 drop-shadow-[0_10px_30px_rgba(30,27,75,0.25)]"
            >
              Post once.
              <br />
              Get on with your <span className="italic">day.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
              className="text-white/85 text-base md:text-lg mt-6 max-w-xl mx-auto drop-shadow"
            >
              Write your post, add your media, choose your accounts, and let Cotly handle the publishing for you.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.3 }}
              className="mt-10 flex flex-col items-center gap-3"
            >
              <motion.a
                href={cta.href}
                onClick={goto(cta.href)}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center gap-2 no-underline bg-white text-[#1e1b4b] rounded-full px-8 py-3.5 text-sm md:text-base font-semibold shadow-xl shadow-[#5b6cf5]/40 hover:shadow-2xl hover:shadow-[#5b6cf5]/50 transition-shadow"
              >
                Start posting
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </motion.a>
              <span className="text-white/70 text-sm">Works with 20+ platforms — X, Threads, Instagram, Bluesky and more.</span>
            </motion.div>
          </div>

          {/* Floating Cotly hero visual with flanking background words */}
          <div className="relative max-w-5xl mx-auto mt-14 md:mt-20">
            <HeroVisual />
          </div>
        </section>

      {/* ================= Content queue ================= */}
      <section id="queue" className="relative py-24 md:py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            {...rise()}
            className="font-instrument text-white text-4xl md:text-5xl text-center drop-shadow-[0_8px_24px_rgba(30,27,75,0.2)]"
          >
            Everything <span className="italic">lined up.</span>
          </motion.h2>
          <motion.p {...rise(0.1)} className="text-white/80 text-center mt-4 max-w-xl mx-auto">
            See what is going out, where it is going, and exactly when Cotly will publish it.
          </motion.p>

          <motion.div {...rise(0.15, 24)} className="mt-12 rounded-3xl sky-glass overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:grid grid-cols-[1.1fr_2fr_1.5fr_0.9fr_0.9fr] gap-4 px-7 py-4 text-[11px] font-semibold uppercase tracking-wider text-[#1e1b4b]/50 border-b border-[#1e1b4b]/10">
              <span>Post</span>
              <span>Caption</span>
              <span>Platforms</span>
              <span>Scheduled</span>
              <span>Status</span>
            </div>
            {QUEUE_ROWS.map((row, i) => (
              <motion.div
                key={row.post}
                initial={{ opacity: 0.18, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.6, ease: EASE, delay: i * 0.12 }}
                className={`relative border-t border-[#1e1b4b]/10 ${i > 0 ? '' : 'md:border-t-0'}`}
              >
                <div className="queue-sweep absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" />
                <div className="hidden md:grid grid-cols-[1.1fr_2fr_1.5fr_0.9fr_0.9fr] gap-4 items-center px-7 py-6">
                  <span className="text-[#1e1b4b] font-semibold">{row.post}</span>
                  <span className="text-[#1e1b4b]/60 text-sm truncate pr-4">{row.caption}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {row.platforms.map((p) => (
                      <span key={p} className="rounded-full bg-white/60 border border-white/80 px-2.5 py-0.5 text-xs font-medium text-[#1e1b4b]/80">
                        {p}
                      </span>
                    ))}
                  </span>
                  <span className="text-sm text-[#1e1b4b]/80 leading-snug">
                    {row.date}
                    <br />
                    <span className="text-[#1e1b4b]/50">{row.time}</span>
                  </span>
                  <span>
                    <StatusPill status={row.status} />
                  </span>
                </div>
                {/* Mobile card */}
                <div className="md:hidden px-5 py-5">
                  <div className="text-[#1e1b4b] font-semibold">{row.post}</div>
                  <div className="text-[#1e1b4b]/60 text-sm mt-1.5">{row.caption}</div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {row.platforms.map((p) => (
                      <span key={p} className="rounded-full bg-white/60 border border-white/80 px-2.5 py-0.5 text-xs font-medium text-[#1e1b4b]/80">
                        {p}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-[#1e1b4b]/70">
                      {row.date} · {row.time}
                    </span>
                    <StatusPill status={row.status} />
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ================= How it works ================= */}
      <section id="how-it-works" className="relative py-24 md:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.h2
            {...rise()}
            className="font-instrument text-white text-4xl md:text-5xl text-center drop-shadow-[0_8px_24px_rgba(30,27,75,0.2)]"
          >
            Three steps. Then get on with <span className="italic">your day.</span>
          </motion.h2>
          <div className="grid md:grid-cols-3 gap-4 mt-14">
            {STEPS.map((s, i) => (
              <motion.div key={s.num} {...rise(i * 0.12, 24)} className="rounded-3xl sky-glass p-7">
                <div className="font-instrument text-white/70 text-lg">{s.num}</div>
                <div className="text-[#1e1b4b] text-lg font-semibold mt-3">{s.title}</div>
                <p className="text-[#1e1b4b]/60 text-sm mt-2 leading-relaxed">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= Final CTA ================= */}
      <section className="relative py-28 md:py-40 px-6 text-center">
        <motion.h2
          {...rise()}
          className="font-instrument text-white text-5xl md:text-7xl drop-shadow-[0_10px_30px_rgba(30,27,75,0.25)]"
        >
          Post it <span className="italic">once.</span>
        </motion.h2>
        <motion.p {...rise(0.1)} className="text-white/80 mt-5 max-w-lg mx-auto">
          Your content has better things to do than sit in twelve different tabs.
        </motion.p>
        <motion.div {...rise(0.2)} className="mt-10">
          <motion.a
            href={cta.href}
            onClick={goto(cta.href)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            className="inline-block no-underline bg-[#232671] text-white rounded-full px-9 py-4 text-sm md:text-base font-semibold shadow-2xl shadow-[#232671]/40"
          >
            Start posting
          </motion.a>
        </motion.div>
      </section>

      {/* ================= Footer ================= */}
      <footer className="relative border-t border-white/40 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#1e1b4b]/60">
          <div className="flex items-center gap-2 text-[#1e1b4b]/80">
            <LogoMark className="w-4 h-4" />
            <span className="font-semibold tracking-tight">Cotly</span>
          </div>
          <p className="text-white/60">© 2026 Cotly. An independent scheduler. Not affiliated with the platforms listed.</p>
          <nav className="flex items-center gap-5">
            <a href="/terms" onClick={goto('/terms')} className="no-underline text-[#1e1b4b]/60 hover:text-[#1e1b4b] transition-colors">Terms</a>
            <a href="/privacy" onClick={goto('/privacy')} className="no-underline text-[#1e1b4b]/60 hover:text-[#1e1b4b] transition-colors">Privacy</a>
            <a href="mailto:hello@cotly.app" className="no-underline text-[#1e1b4b]/60 hover:text-[#1e1b4b] transition-colors">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function StatusPill({ status }: { status: 'Scheduled' | 'Preparing' }) {
  if (status === 'Preparing') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-white/60 border border-white/80 px-2.5 py-1 text-xs font-medium text-[#1e1b4b]/80">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#5b6cf5] opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#5b6cf5]" />
        </span>
        Preparing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-white/60 border border-white/80 px-2.5 py-1 text-xs font-medium text-[#1e1b4b]/80">
      Scheduled
    </span>
  );
}
