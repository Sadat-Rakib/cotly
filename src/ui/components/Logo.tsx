// The Cotly mark: a thin "C" ring with a single leaf reaching through the
// opening — a nod to posting something small that grows. Stroke-based and
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
      {/* Leaf through the gap */}
      <path d="M18.2 13.8c.4-3.4 2.6-5.9 6.6-6.8-.5 3.9-2.9 6.2-6.6 6.8z" fill="currentColor" />
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
