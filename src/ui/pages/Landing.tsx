import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Flower2 } from 'lucide-react';

interface Props {
  navigate: (p: string) => void;
}

// Easings reused by every animation on the page.
const EASE_ENTRANCE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_OVERLAY = 'cubic-bezier(0.76, 0, 0.24, 1)';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260819_212700_3bb9329b-5c50-4257-a09b-ca85cf3654a3.mp4';

const MENU_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Open Cotly', href: '/app' },
  { label: 'Connect accounts', href: '/app/accounts' },
  { label: 'Sign in', href: '/login' },
];

// Entrance animation helper: the delay only applies once the element is shown,
// so the initial paint is never pre-delayed.
const enter = (shown: boolean, delayMs: number, durationMs: number): CSSProperties => ({
  transitionDelay: shown ? `${delayMs}ms` : '0ms',
  transitionDuration: `${durationMs}ms`,
  transitionTimingFunction: EASE_ENTRANCE,
});

export function Landing({ navigate }: Props) {
  const [navIn, setNavIn] = useState(false);
  const [heroIn, setHeroIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setNavIn(true), 100);
    const t2 = setTimeout(() => setHeroIn(true), 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock the page behind the full-screen menu; restore on close and on unmount
  // (a link click navigates away with the menu still "open").
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const go = (href: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setMenuOpen(false);
    if (href !== window.location.pathname) navigate(href);
  };

  // Navbar pieces rise in on load: logo 0ms, Navigate/hamburger 200ms, flower 400ms.
  const navItem = (shown: boolean, delayMs: number, extra = '') => ({
    className: `${extra} transform transition-all duration-700 ${
      shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
    }`.trim(),
    style: enter(shown, delayMs, 700),
  });

  return (
    <div className="bg-black">
      {/* ---------- Navbar ---------- */}
      <header
        className={`fixed top-0 left-0 w-full z-50 transition-all duration-500 ${
          scrolled ? 'bg-black/80 backdrop-blur-md' : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-6 md:px-10 flex items-center justify-between h-16 md:h-20">
          <a href="/" onClick={go('/')} {...navItem(navIn, 0, 'z-50 no-underline text-white text-xl md:text-2xl font-semibold tracking-tight')}>
            cotly
          </a>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            {...navItem(navIn, 200, 'hidden md:flex items-center gap-2 px-5 py-2 rounded-full border border-white/20 text-white/90 text-sm hover:bg-white/10')}
          >
            {menuOpen ? 'Close' : 'Navigate'}
          </button>

          <div {...navItem(navIn, 400, 'hidden md:block')}>
            <Flower2 className="w-7 h-7 text-white/90" />
          </div>

          <button
            type="button"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
            {...navItem(navIn, 200, 'md:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5')}
          >
            <span
              className="w-6 h-[2px] bg-white transition-all duration-500"
              style={{
                transitionTimingFunction: EASE_OVERLAY,
                transform: menuOpen ? 'translateY(4px) rotate(45deg)' : 'none',
              }}
            />
            <span
              className="w-6 h-[2px] bg-white transition-all duration-500"
              style={{
                transitionTimingFunction: EASE_OVERLAY,
                transform: menuOpen ? 'translateY(-4px) rotate(-45deg)' : 'none',
              }}
            />
          </button>
        </div>
      </header>

      {/* ---------- Full-screen overlay menu ---------- */}
      <div
        className={`fixed inset-0 z-40 bg-black flex flex-col items-center justify-center transition-all duration-[700ms] ${
          menuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        style={{ transitionTimingFunction: EASE_OVERLAY }}
      >
        <nav className="flex flex-col items-center gap-8">
          {MENU_LINKS.map((link, i) => (
            <a
              key={link.label}
              href={link.href}
              onClick={go(link.href)}
              className={`font-instrument no-underline text-white text-4xl md:text-6xl hover:opacity-60 transform transition-all duration-[600ms] ${
                menuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
              }`}
              style={{
                transitionDelay: menuOpen ? `${150 + i * 80}ms` : '0ms',
                transitionTimingFunction: EASE_OVERLAY,
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      {/* ---------- Hero ---------- */}
      <section className="relative w-full h-screen overflow-hidden flex items-end justify-center">
        <div
          className={`absolute inset-0 transform transition-all duration-[1400ms] ${
            heroIn ? 'scale-100 opacity-100' : 'scale-105 opacity-0'
          }`}
          style={enter(heroIn, 0, 1400)}
        >
          <video src={VIDEO_URL} autoPlay muted loop playsInline className="w-full h-full object-cover" />
        </div>

        <div className="relative z-10 text-center px-6 pb-16 md:pb-24 max-w-4xl mx-auto">
          <h1
            className={`font-instrument text-white text-[2.5rem] leading-[0.95] sm:text-5xl md:text-6xl lg:text-7xl mb-5 md:mb-6 transform transition-all duration-[900ms] ${
              heroIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
            style={enter(heroIn, 400, 900)}
          >
            Post once.
            <br className="hidden sm:block" /> Get on with your day.
          </h1>

          <p
            className={`text-white/70 text-base md:text-lg mb-8 md:mb-10 max-w-md mx-auto transform transition-all duration-[900ms] ${
              heroIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
            style={enter(heroIn, 600, 900)}
          >
            Upload your content, connect your accounts, choose when it should go live, and Cotly handles the schedule.
          </p>

          <a
            href="/app"
            onClick={go('/app')}
            className={`no-underline inline-block px-8 py-3.5 bg-white text-black text-sm md:text-base font-medium rounded-full hover:bg-white/90 transform transition-all duration-[900ms] ${
              heroIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
            style={enter(heroIn, 800, 900)}
          >
            Open Cotly
          </a>
        </div>
      </section>
    </div>
  );
}
