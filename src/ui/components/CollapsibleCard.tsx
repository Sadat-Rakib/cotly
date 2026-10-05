import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  /** Small summary rendered in the header (counts, times, chips). */
  badge?: ReactNode;
  defaultOpen?: boolean;
  id?: string;
  children: ReactNode;
}

// Collapsible compose section. Collapsing unmounts only the body — every
// value lives in the parent's state, so entered content is never lost.
export function CollapsibleCard({ title, badge, defaultOpen = true, id, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`card fold${open ? ' open' : ''}`} id={id}>
      <button
        type="button"
        className="fold-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="fold-title">{title}</span>
        {badge !== undefined && badge !== null && <span className="fold-badge">{badge}</span>}
        <ChevronDown className="fold-chevron" aria-hidden="true" />
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
