import { Logo } from '../components/Logo';

// Shared shell for the public legal/informational pages. Full-bleed black,
// editorial type, thin rules — the same language as the landing.
export function LegalShell({
  title,
  accent,
  updated,
  children,
}: {
  title: string;
  accent: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <header className="border-b border-white/[0.08]">
        <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-28 h-16 md:h-20 flex items-center justify-between">
          <a href="/" className="no-underline text-white">
            <Logo markClass="w-6 h-6" wordClass="text-xl font-semibold tracking-tight" />
          </a>
          <nav className="flex items-center gap-6 text-sm">
            <a href="/terms" className="no-underline text-white/60 hover:text-white transition-colors">Terms</a>
            <a href="/services" className="no-underline text-white/60 hover:text-white transition-colors">Services</a>
            <a href="/privacy" className="no-underline text-white/60 hover:text-white transition-colors">Privacy</a>
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16 md:py-24">
        <h1 className="text-4xl md:text-5xl font-medium tracking-[-1px] leading-tight">
          {title} <span className="font-instrument italic font-normal">{accent}</span>
        </h1>
        <p className="text-white/40 text-sm mt-3">Last updated {updated}</p>
        <div className="legal-prose mt-10 flex flex-col gap-5">{children}</div>
      </main>

      <footer className="border-t border-white/[0.06] py-10 px-6">
        <div className="max-w-2xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <span className="text-white/60">© 2026 Cotly. An independent scheduler.</span>
          <span>
            Questions? <a className="text-white/70 underline-offset-4 hover:underline" href="mailto:support@cotly.app">support@cotly.app</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-white text-lg font-medium mt-4">{heading}</h2>
      <div className="text-white/55 text-sm leading-relaxed mt-2 flex flex-col gap-3">{children}</div>
    </section>
  );
}
