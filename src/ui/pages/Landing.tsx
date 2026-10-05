import { useEffect, useState, type ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, MoreHorizontal, Sparkles } from 'lucide-react';
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
type DemoPlatform = 'x' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin';

const QUEUE_ROWS: Array<{
  post: string;
  caption: string;
  platforms: DemoPlatform[];
  date: string;
  time: string;
  status: 'Scheduled' | 'Preparing';
  thumb: string;
}> = [
  {
    post: 'Product launch',
    caption: '"We\'ve been building something new..."',
    platforms: ['x', 'linkedin', 'youtube'],
    date: 'Oct 4',
    time: '9:30 AM',
    status: 'Scheduled',
    thumb: 'from-[#c4a9f5] to-[#f3cce8]',
  },
  {
    post: 'Behind the scenes',
    caption: '"A quick look at what went into this..."',
    platforms: ['instagram', 'tiktok'],
    date: 'Oct 4',
    time: '1:00 PM',
    status: 'Scheduled',
    thumb: 'from-[#9ecbff] to-[#c4a9f5]',
  },
  {
    post: 'Launch walkthrough',
    caption: '"Here\'s the full walkthrough!"',
    platforms: ['youtube', 'x', 'linkedin'],
    date: 'Oct 5',
    time: '10:00 AM',
    status: 'Preparing',
    thumb: 'from-[#f3cce8] to-[#fbe8d0]',
  },
  {
    post: 'Weekend update',
    caption: '"Everything we shipped this week."',
    platforms: ['x', 'instagram'],
    date: 'Oct 5',
    time: '4:30 PM',
    status: 'Scheduled',
    thumb: 'from-[#b8e3ff] to-[#d9c8ff]',
  },
];

const PLATFORM_META: Record<DemoPlatform, { label: string; icon: (p: { className?: string }) => ReactElement; chip: string }> = {
  x: { label: 'X', icon: XIcon, chip: 'bg-[#0f1419] text-white' },
  instagram: { label: 'Instagram', icon: InstagramIcon, chip: 'bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white' },
  tiktok: { label: 'TikTok', icon: TikTokIcon, chip: 'bg-[#0f1419] text-white' },
  youtube: { label: 'YouTube', icon: YouTubeIcon, chip: 'bg-[#ff0000] text-white' },
  linkedin: { label: 'LinkedIn', icon: LinkedInIcon, chip: 'bg-[#0a66c2] text-white' },
};

const STEPS = [
  { num: '01', title: 'Add your content', body: 'Write your caption and upload your image or video.', img: '/brand/clay-content.webp' },
  { num: '02', title: 'Choose your accounts', body: 'Select exactly where Cotly should publish it.', img: '/brand/clay-platforms.webp' },
  { num: '03', title: 'Choose the time', body: 'Publish now or schedule it for later.', img: '/brand/clay-time.webp' },
];

const EASE = [0.16, 1, 0.3, 1] as const;

const rise = (delay = 0, y = 16) => ({
  initial: { opacity: 0, y },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.7, ease: EASE, delay },
});

// One giant atmospheric phrase anchored to one edge, oscillating slowly and
// smoothly (no marquee reset). Decorative only; movement respects
// prefers-reduced-motion via CSS.
function GhostLine({ phrase, side }: { phrase: string; side: 'left' | 'right' }) {
  return (
    <div className={`ghost-line ghost-${side}`} aria-hidden="true">
      <span>{phrase}</span>
    </div>
  );
}

// The hero centerpiece: the supplied holographic projector render (with its
// own clean alpha), floating gently over the supplied sky. Width capped per
// spec; the soft glow follows the asset's alpha shape.
function HeroVisual() {
  return (
    <div className="relative mx-auto w-[min(100%,680px)] md:w-[min(88%,740px)] lg:w-[min(78%,780px)]">
      <motion.img
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.45 }}
        src="/brand/hero-device.webp"
        alt="Cotly social publishing dashboard illustration"
        draggable={false}
        className="relative z-10 w-full h-auto select-none hero-float hero-glow"
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE, delay: 1 }}
        aria-hidden="true"
        className="hidden lg:block absolute z-10 -right-16 xl:-right-24 top-[34%] -rotate-6 text-right"
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
        <div className="max-w-[1240px] mx-auto px-6 md:px-10 flex items-center justify-between h-16 md:py-5 md:h-auto">
          <a href="/" onClick={goto('/')} className="no-underline text-white">
            <Logo markClass="w-6 h-6" wordClass="text-xl font-semibold tracking-tight" />
          </a>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.slice(0, 3).map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={l.onClick}
                className="no-underline text-sm font-medium text-white/70 hover:text-white transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <motion.a
              href={cta.href}
              onClick={goto(cta.href)}
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.98 }}
              className="hidden md:inline-flex md:items-center md:gap-1.5 no-underline bg-white/95 text-[#1e1b4b] text-sm font-semibold rounded-full px-5 py-2 shadow-lg shadow-[#232671]/30 hover:bg-white hover:shadow-xl hover:shadow-[#232671]/40 transition-all"
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
                className="w-6 h-[2px] bg-white transition-transform duration-500"
                style={{ transform: menuOpen ? 'translateY(4px) rotate(45deg)' : 'none' }}
              />
              <span
                className="w-6 h-[2px] bg-white transition-transform duration-500"
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
            className={`font-instrument no-underline text-4xl hover:opacity-70 drop-shadow ${
              l.cta
                ? 'text-2xl mt-4 bg-white text-[#1e1b4b] rounded-full px-8 py-3 shadow-xl'
                : 'text-white'
            }`}
          >
            {l.label}
          </a>
        ))}
      </div>

        {/* ================= Hero ================= */}
        <section className="relative w-full overflow-hidden min-h-[100svh] flex flex-col">
          {/* Layer 1-2: supplied sky background + subtle contrast overlay.
              The image is masked out at the bottom so the page gradient shows
              through — no seam into the next section. */}
          <div className="absolute inset-0 z-0" aria-hidden="true">
            <img
              src="/brand/hero-sky.webp"
              alt=""
              className="w-full h-full object-cover object-center hero-sky-fade"
              draggable={false}
            />
            <div className="absolute inset-x-0 top-0 h-[38%] bg-gradient-to-b from-[#1e1b4b]/25 via-[#1e1b4b]/8 to-transparent" />
          </div>

          {/* Layer 3: giant animated background typography. */}
          <div className="absolute inset-x-0 top-[41%] md:top-[44%] z-[1]">
            <GhostLine phrase="POST ONCE." side="left" />
            <GhostLine phrase="GET ON WITH YOUR DAY." side="right" />
          </div>

          <div className="relative z-10 text-center px-6 max-w-4xl mx-auto pt-32 md:pt-40">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="inline-flex items-center gap-2 liquid-glass rounded-full pl-3 pr-3.5 py-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0 text-white/90" aria-hidden="true" />
              <span className="text-white text-[13px] md:text-sm font-medium whitespace-nowrap drop-shadow">20+ platforms supported</span>
              <span className="flex items-center gap-1 shrink-0">
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
              className="font-instrument text-white text-[46px] md:text-[64px] lg:text-[84px] leading-[1.04] mt-8 drop-shadow-[0_10px_30px_rgba(30,27,75,0.25)]"
            >
              Post once.
              <br />
              Get on with your <span className="italic">day.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
              className="text-white/85 text-[17px] md:text-[19px] mt-6 max-w-[620px] mx-auto drop-shadow"
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
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 no-underline bg-white text-[#1e1b4b] rounded-full px-9 py-4 text-sm md:text-base font-semibold shadow-xl shadow-[#3a2f9e]/40 hover:shadow-2xl hover:shadow-[#3a2f9e]/55 transition-shadow"
              >
                Start posting
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </motion.a>
              <span className="text-white/70 text-sm">Works with 20+ platforms — X, Threads, Instagram, Bluesky and more.</span>
            </motion.div>
          </div>

          {/* Layer 4: the holographic centerpiece, integrated into the sky. */}
          <div className="relative z-10 mx-auto mt-14 md:mt-20 pb-10 md:pb-16">
            <HeroVisual />
          </div>
        </section>

      {/* ================= Everything lined up (ASSET 1 sky) ================= */}
      <section id="queue" className="relative overflow-hidden">
        <div className="absolute inset-0 z-0" aria-hidden="true">
          <img
            src="/brand/queue-sky.webp"
            alt=""
            draggable={false}
            className="w-full h-full object-cover object-center section-sky-a"
          />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-24 md:py-36">
          <motion.h2
            {...rise()}
            className="font-instrument text-[#1e1b4b] text-4xl md:text-6xl text-center"
          >
            Everything <span className="italic">lined up.</span>
          </motion.h2>
          <motion.p {...rise(0.08)} className="text-[#1e1b4b]/70 text-center mt-4 max-w-xl mx-auto">
            See what's going out, where it's going, and exactly when Cotly will publish it.
          </motion.p>

          <motion.div {...rise(0.15, 24)} className="mt-12">
            {/* Desktop: real glass scheduling table */}
            <div className="hidden md:block glass-table">
              <div className="queue-grid px-7 py-4 text-[11px] font-semibold uppercase tracking-wider text-[#1e1b4b]/55 border-b border-[#1e1b4b]/10">
                <span>Post</span>
                <span>Caption</span>
                <span>Platforms</span>
                <span>Scheduled</span>
                <span>Status</span>
                <span />
              </div>
              {QUEUE_ROWS.map((row) => (
                <div key={row.post} className="queue-grid items-center px-7 py-5 border-t border-[#1e1b4b]/8">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className={`w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br ${row.thumb} border border-white shadow-sm`} aria-hidden="true" />
                    <span className="text-[#1e1b4b] font-semibold truncate">{row.post}</span>
                  </span>
                  <span className="text-[#1e1b4b]/60 text-sm truncate pr-4">{row.caption}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {row.platforms.map((p) => (
                      <PlatformPill key={p} platform={p} />
                    ))}
                  </span>
                  <span className="text-sm text-[#1e1b4b]/80 leading-snug">
                    {row.date}
                    <br />
                    <span className="text-[#1e1b4b]/50">{row.time}</span>
                  </span>
                  <span><StatusPill status={row.status} /></span>
                  <span className="justify-self-end">
                    <button type="button" aria-label={`More options for ${row.post}`} className="p-1.5 rounded-full text-[#1e1b4b]/40 hover:text-[#1e1b4b]/80 hover:bg-white/70 transition-colors">
                      <MoreHorizontal className="w-[18px] h-[18px]" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            {/* Mobile: the same rows as glass cards */}
            <div className="md:hidden flex flex-col gap-3">
              {QUEUE_ROWS.map((row) => (
                <div key={row.post} className="glass-table p-5">
                  <div className="flex items-center gap-3">
                    <span className={`w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br ${row.thumb} border border-white shadow-sm`} aria-hidden="true" />
                    <span className="text-[#1e1b4b] font-semibold flex-1 truncate">{row.post}</span>
                    <StatusPill status={row.status} />
                  </div>
                  <div className="text-[#1e1b4b]/60 text-sm mt-2">{row.caption}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    {row.platforms.map((p) => (
                      <PlatformPill key={p} platform={p} />
                    ))}
                    <span className="ml-auto text-xs text-[#1e1b4b]/60">{row.date} · {row.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============ Steps + CTA + Footer (ASSET 2 sunrise, one scene) ============ */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 z-0" aria-hidden="true">
          <img
            src="/brand/sunrise.webp"
            alt=""
            draggable={false}
            className="w-full h-full object-cover object-center section-sky-b"
          />
        </div>

        {/* -------- Three steps -------- */}
        <section id="how-it-works" className="relative z-10 pt-24 md:pt-36 pb-10 px-6">
          <div className="max-w-5xl mx-auto">
            <motion.h2
              {...rise()}
              className="font-instrument text-[#1e1b4b] text-4xl md:text-6xl text-center"
            >
              Three steps. Then get on with <span className="italic">your day.</span>
            </motion.h2>
            <div className="grid md:grid-cols-3 gap-5 md:gap-6 mt-14 md:mt-20">
              {STEPS.map((s, i) => (
                <motion.div
                  key={s.num}
                  {...rise(i * 0.12, 24)}
                  className={`step-card relative text-center px-7 pt-8 pb-9 ${i === 1 ? 'md:mt-10' : ''}`}
                >
                  <span className="step-num">{s.num}</span>
                  <img
                    src={s.img}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="clay-float h-32 md:h-36 mx-auto object-contain select-none"
                    style={{ animationDelay: `${i * 1.2}s` }}
                  />
                  <h3 className="text-[#1e1b4b] text-xl font-semibold mt-5">{s.title}</h3>
                  <p className="text-[#1e1b4b]/65 text-sm mt-2 leading-relaxed">{s.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* -------- Final CTA -------- */}
        <section className="relative z-10 py-28 md:py-44 px-6 text-center">
          <motion.h2
            {...rise()}
            className="font-instrument text-[#1e1b4b] text-5xl md:text-7xl"
          >
            Post it <span className="italic">once.</span>
          </motion.h2>
          <motion.p {...rise(0.1)} className="text-[#1e1b4b]/70 mt-5 max-w-lg mx-auto">
            Your content has better things to do than sit in twelve different tabs.
          </motion.p>
          <motion.div {...rise(0.2)} className="mt-10">
            <motion.a
              href={cta.href}
              onClick={goto(cta.href)}
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 no-underline bg-[#232671] text-white rounded-full px-9 py-4 text-sm md:text-base font-semibold shadow-2xl shadow-[#232671]/40 hover:shadow-[#232671]/55 transition-shadow"
            >
              Start posting
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </motion.a>
          </motion.div>
        </section>

        {/* -------- Footer -------- */}
        <footer className="relative z-10 max-w-6xl mx-auto px-6 pb-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#1e1b4b]/75">
            <div className="flex items-center gap-2 text-[#1e1b4b]">
              <LogoMark className="w-4 h-4" />
              <span className="font-semibold tracking-tight">Cotly</span>
            </div>
            <nav className="flex items-center gap-6">
              <a href="/terms" onClick={goto('/terms')} className="no-underline text-[#1e1b4b]/70 hover:text-[#1e1b4b] transition-colors">Terms</a>
              <a href="/privacy" onClick={goto('/privacy')} className="no-underline text-[#1e1b4b]/70 hover:text-[#1e1b4b] transition-colors">Privacy</a>
              <a href="mailto:hello@cotly.app" className="no-underline text-[#1e1b4b]/70 hover:text-[#1e1b4b] transition-colors">Contact</a>
            </nav>
          </div>
          <p className="text-center text-[#1e1b4b]/50 text-xs mt-7">© 2026 Cotly.</p>
        </footer>
      </div>
    </div>
  );
}

function PlatformPill({ platform }: { platform: DemoPlatform }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 border border-white/90 px-2 py-1 text-xs font-medium text-[#1e1b4b]/80 shadow-sm">
      <span className={`inline-flex items-center justify-center w-[14px] h-[14px] rounded-full ${meta.chip}`}>
        <Icon className="w-[9px] h-[9px]" />
      </span>
      {meta.label}
    </span>
  );
}

function StatusPill({ status }: { status: 'Scheduled' | 'Preparing' }) {
  if (status === 'Preparing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ece9fc] border border-[#d8d2f5] px-2.5 py-1 text-xs font-semibold text-[#5b50c7]">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#7c6cf0] opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#7c6cf0]" />
        </span>
        Preparing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f7ee] border border-[#bfe8cf] px-2.5 py-1 text-xs font-semibold text-[#1c7a4a]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#2fae6d]" />
      Scheduled
    </span>
  );
}
