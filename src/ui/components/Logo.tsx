// The Cotly mark: an open "C" ring with a single dot exiting through the
// gap — a post leaving the composer on its way out. Stroke-based and
// currentColor so it sits on any surface at any size.

interface MarkProps {
  className?: string;
}

export function LogoMark({ className = 'w-6 h-6' }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true" focusable="false">
      {/* C ring: dashed circle with the gap centered at 3 o'clock, rounded caps */}
      <circle
        cx="16"
        cy="16"
        r="10.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="52.8 13.2"
        transform="rotate(36 16 16)"
      />
      {/* The dot, just outside the gap — published */}
      <circle cx="28.2" cy="16" r="2.5" fill="currentColor" />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  markClass?: string;
  wordClass?: string;
}

export function Logo({ className = '', markClass = 'w-6 h-6', wordClass = 'text-xl font-semibold tracking-tight' }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 text-current ${className}`}>
      <LogoMark className={markClass} />
      <span className={wordClass}>cotly</span>
    </span>
  );
}
