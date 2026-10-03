import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Check, Flower2 } from 'lucide-react';
import { PLATFORM_REGISTRY, STATE_LABEL, type PlatformState } from '../../contracts/platforms';

interface Props {
  navigate: (p: string) => void;
  authed: boolean;
}

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4';

const NAV_LINKS = [
  { label: 'Home', href: '#top' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Platforms', href: '#platforms' },
  { label: 'Schedule', href: '#queue' },
];

// Demo rows for the scheduling showcase. These demonstrate the product; they
// are not testimonials and name no customers.
const QUEUE_ROWS = [
  {
    post: 'Product launch',
    caption: '"We\'ve been building something new. It\'s finally ready."',
    platforms: ['Bluesky', 'X', 'LinkedIn'],
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
    platforms: ['Bluesky', 'X', 'Mastodon'],
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

const STATE_PILL: Record<PlatformState, string> = {
  available: 'bg-white text-black',
  ready: 'border border-white/25 text-white/80',
  adapter: 'border border-white/15 text-white/60',
  coming: 'border border-white/10 text-white/40',
};

const EASE = [0.16, 1, 0.3, 1] as const;

const rise = (delay = 0, y = 16) => ({
  initial: { opacity: 0, y },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.7, ease: EASE, delay },
});

export function Landing({ navigate, authed }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
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

  // Hero parallax: copy drifts up and fades, the product preview follows.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : -180]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.8], [1, reduceMotion ? 1 : 0]);
  const productY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : -220]);

  const cta = {
    label: authed ? 'Open Cotly' : 'Start posting',
    href: authed ? '/app' : '/login',
  };

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

  return (
    <div className="bg-black text-white antialiased" id="top">
      {/* ================= Navbar ================= */}
      <header
        className={`fixed top-0 left-0 w-full z-50 transition-all duration-500 ${
          scrolled ? 'bg-black/80 backdrop-blur-md' : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-28 flex items-center justify-between h-16 md:py-5 md:h-auto">
          <a href="/" onClick={goto('/')} className="flex items-center gap-2 no-underline text-white">
            <Flower2 className="w-6 h-6 text-white/90" />
            <span className="text-xl font-semibold tracking-tight">cotly</span>
          </a>

          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={jump(l.href)}
                className="no-underline text-sm text-white/60 hover:text-white transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {!authed && (
              <a href="/login" onClick={goto('/login')} className="hidden md:inline-block no-underline text-sm text-white/70 hover:text-white transition-colors">
                Sign in
              </a>
            )}
            <a
              href={cta.href}
              onClick={goto(cta.href)}
              className="hidden md:inline-block no-underline bg-white text-black text-sm font-semibold rounded-lg px-4 py-2 hover:bg-white/90 transition-colors"
            >
              {cta.label}
            </a>
            <button
              type="button"
              aria-label="Toggle menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden w-9 h-9 flex flex-col items-center justify-center gap-1.5"
            >
              <span
                className="w-6 h-[2px] bg-white transition-transform duration-500"
                style={{ transform: menuOpen ? 'translateY(4px) rotate(45deg)' : 'none', transitionTimingFunction: 'cubic-bezier(0.76, 0, 0.24, 1)' }}
              />
              <span
                className="w-6 h-[2px] bg-white transition-transform duration-500"
                style={{ transform: menuOpen ? 'translateY(-4px) rotate(-45deg)' : 'none', transitionTimingFunction: 'cubic-bezier(0.76, 0, 0.24, 1)' }}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ================= Mobile menu ================= */}
      <div
        className={`fixed inset-0 z-40 bg-black flex flex-col items-center justify-center gap-8 transition-all duration-500 ${
          menuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.76, 0, 0.24, 1)' }}
      >
        {NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={jump(l.href)} className="font-instrument no-underline text-white text-4xl hover:opacity-60">
            {l.label}
          </a>
        ))}
        <a href={cta.href} onClick={goto(cta.href)} className="font-instrument no-underline text-white text-4xl hover:opacity-60">
          {cta.label}
        </a>
        {!authed && (
          <a href="/login" onClick={goto('/login')} className="no-underline text-white/50 text-sm hover:text-white">
            Sign in
          </a>
        )}
      </div>

      {/* ================= Hero ================= */}
      <section ref={heroRef} className="relative w-full overflow-hidden pt-32 md:pt-44 pb-16 md:pb-24">
        <motion.div style={{ y: copyY, opacity: copyOpacity }} className="text-center px-6 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="inline-flex items-center gap-2.5 liquid-glass rounded-full px-4 py-1.5"
          >
            <span className="bg-white text-black text-[11px] font-semibold rounded-full px-2 py-0.5">New</span>
            <span className="text-white/80 text-sm">Post everywhere from one place.</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
            className="text-white text-5xl md:text-7xl font-medium tracking-[-2px] leading-tight mt-8"
          >
            Post once.
            <br />
            Get on with your <span className="font-instrument italic font-normal">day.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
            className="text-white/60 text-base md:text-lg mt-6 max-w-xl mx-auto"
          >
            Write your post, add your media, choose your accounts, and tell Cotly when it should go live. Cotly handles
            the rest.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.3 }}
            className="mt-10"
          >
            <motion.a
              href={cta.href}
              onClick={goto(cta.href)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="inline-block no-underline bg-white text-black rounded-full px-8 py-3.5 text-sm md:text-base font-medium"
            >
              {cta.label}
            </motion.a>
          </motion.div>
        </motion.div>

        {/* Cinematic area with the real Cotly composer preview */}
        <motion.div style={{ y: productY }} className="relative max-w-5xl mx-auto px-6 mt-16 md:mt-24">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.4 }}
            className="relative rounded-2xl overflow-hidden border border-white/10"
          >
            <video src={VIDEO_URL} autoPlay muted loop playsInline className="w-full aspect-video object-cover" />
            <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

            <div className="absolute inset-0 flex items-center justify-center p-4 md:p-8">
              <div
                className="w-full max-w-md rounded-xl border border-white/10 bg-[hsl(0_0%_5%/0.92)] backdrop-blur-md p-5 select-none"
                aria-hidden="true"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Create Post</span>
                  <span className="text-[11px] text-white/40">Draft saved</span>
                </div>

                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Caption</div>
                  <p className="text-sm text-white/90 mt-1.5">Launching something new this Friday.</p>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg bg-[hsl(0_0%_9%)] border border-white/10 flex items-center justify-center text-[10px] text-white/40">
                    IMG
                  </div>
                  <div className="text-xs text-white/50">
                    launch-teaser.jpg
                    <div className="text-white/30">1.2 MB · PNG</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Selected</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {['Bluesky', 'X', 'LinkedIn'].map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs text-white/85">
                        <Check className="w-3 h-3" />
                        {p}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-white/40">Schedule</div>
                    <div className="text-sm text-white/90 mt-0.5">Friday · 9:30 AM</div>
                  </div>
                  <span className="bg-white text-black text-sm font-semibold rounded-lg px-4 py-2">Schedule post</span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ================= Content queue ================= */}
      <section id="queue" className="py-24 md:py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.h2 {...rise()} className="text-4xl md:text-5xl font-medium tracking-[-1px] text-center">
            Everything <span className="font-instrument italic font-normal">lined up.</span>
          </motion.h2>
          <motion.p {...rise(0.1)} className="text-white/55 text-center mt-4 max-w-xl mx-auto">
            See what is going out, where it is going, and exactly when Cotly will publish it.
          </motion.p>

          <motion.div {...rise(0.15, 24)} className="mt-12 rounded-2xl border border-[hsl(0_0%_16%)] bg-[hsl(0_0%_4%)] overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:grid grid-cols-[1.1fr_2fr_1.5fr_0.9fr_0.9fr] gap-4 px-7 py-4 text-[11px] uppercase tracking-wider text-white/40 border-b border-white/[0.06]">
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
                className={`relative border-t border-white/[0.06] ${i > 0 ? '' : 'md:border-t-0'}`}
              >
                <div className="queue-sweep absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" />
                <div className="hidden md:grid grid-cols-[1.1fr_2fr_1.5fr_0.9fr_0.9fr] gap-4 items-center px-7 py-6">
                  <span className="text-white font-medium">{row.post}</span>
                  <span className="text-white/50 text-sm truncate pr-4">{row.caption}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {row.platforms.map((p) => (
                      <span key={p} className="rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-0.5 text-xs text-white/75">
                        {p}
                      </span>
                    ))}
                  </span>
                  <span className="text-sm text-white/80 leading-snug">
                    {row.date}
                    <br />
                    <span className="text-white/45">{row.time}</span>
                  </span>
                  <span>
                    <StatusPill status={row.status} />
                  </span>
                </div>
                {/* Mobile card */}
                <div className="md:hidden px-5 py-5">
                  <div className="text-white font-medium">{row.post}</div>
                  <div className="text-white/50 text-sm mt-1.5">{row.caption}</div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {row.platforms.map((p) => (
                      <span key={p} className="rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-0.5 text-xs text-white/75">
                        {p}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-white/70">
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
      <section id="how-it-works" className="py-24 md:py-32 px-6 border-t border-white/[0.05]">
        <div className="max-w-5xl mx-auto">
          <motion.h2 {...rise()} className="text-4xl md:text-5xl font-medium tracking-[-1px] text-center">
            Three steps. Then get on with <span className="font-instrument italic font-normal">your day.</span>
          </motion.h2>
          <div className="grid md:grid-cols-3 gap-4 mt-14">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.num}
                {...rise(i * 0.12, 24)}
                className="rounded-2xl border border-[hsl(0_0%_16%)] bg-[hsl(0_0%_4%)] p-7"
              >
                <div className="text-white/35 text-sm tracking-widest">{s.num}</div>
                <div className="text-white text-lg font-medium mt-4">{s.title}</div>
                <p className="text-white/50 text-sm mt-2 leading-relaxed">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= Platforms ================= */}
      <section id="platforms" className="py-24 md:py-32 px-6 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <motion.h2 {...rise()} className="text-4xl md:text-5xl font-medium tracking-[-1px] text-center">
            One post. <span className="font-instrument italic font-normal">More places.</span>
          </motion.h2>
          <motion.p {...rise(0.1)} className="text-white/55 text-center mt-4 max-w-xl mx-auto">
            Connect the accounts you actually use. Cotly handles the publishing flow for each one.
          </motion.p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-14">
            {PLATFORM_REGISTRY.map((p, i) => (
              <motion.div
                key={p.id}
                {...rise((i % 3) * 0.08, 18)}
                className="rounded-xl border border-[hsl(0_0%_14%)] bg-[hsl(0_0%_4%)] p-5 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white font-medium">{p.label}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] whitespace-nowrap ${STATE_PILL[p.state]}`}>
                    {STATE_LABEL[p.state]}
                  </span>
                </div>
                <p className="text-white/45 text-sm leading-relaxed">{p.note}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= Final CTA ================= */}
      <section className="py-28 md:py-40 px-6 text-center border-t border-white/[0.05]">
        <motion.h2 {...rise()} className="text-4xl md:text-6xl font-medium tracking-[-1px]">
          Post it <span className="font-instrument italic font-normal">once.</span>
        </motion.h2>
        <motion.p {...rise(0.1)} className="text-white/55 mt-5 max-w-lg mx-auto">
          Your content has better things to do than sit in twelve different tabs.
        </motion.p>
        <motion.div {...rise(0.2)} className="mt-10">
          <motion.a
            href={cta.href}
            onClick={goto(cta.href)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            className="inline-block no-underline bg-white text-black rounded-full px-8 py-3.5 text-sm md:text-base font-medium"
          >
            {cta.label}
          </motion.a>
        </motion.div>
      </section>

      {/* ================= Footer ================= */}
      <footer className="border-t border-white/[0.06] py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <div className="flex items-center gap-2 text-white/60">
            <Flower2 className="w-4 h-4" />
            <span className="font-semibold tracking-tight">cotly</span>
          </div>
          <p>© 2026 Cotly. An independent scheduler. Not affiliated with the platforms listed.</p>
        </div>
      </footer>
    </div>
  );
}

function StatusPill({ status }: { status: 'Scheduled' | 'Preparing' }) {
  if (status === 'Preparing') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-xs text-white/75">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        Preparing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-xs text-white/75">
      Scheduled
    </span>
  );
}
