import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** When true, backdrop click and Escape are ignored (use for dirty/unsaved state). */
  disableDismiss?: boolean;
  /** Optional confirm gate; return false to veto a dismiss (e.g. unsaved changes). */
  onBeforeClose?: () => boolean;
}

// Counts nested/stacked modals so body scroll-lock is only released by the last one.
let openModalCount = 0;

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, disableDismiss, onBeforeClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const attemptClose = useCallback(() => {
    if (disableDismiss) return;
    if (onBeforeClose && !onBeforeClose()) return;
    onClose();
  }, [disableDismiss, onBeforeClose, onClose]);

  // Scroll lock (ref-counted for stacked modals) + focus save/restore.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    openModalCount += 1;
    const prevOverflow = document.body.style.overflow;
    if (openModalCount === 1) document.body.style.overflow = 'hidden';

    // Move focus into the dialog.
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? dialogRef.current)?.focus();

    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // Escape to close + Tab focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        attemptClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [attemptClose]);

  // Portal to <body>: app cards use backdrop-filter, which makes them the
  // containing block for position:fixed descendants — without the portal the
  // overlay would size/position against the card instead of the viewport
  // (broken on mobile, where cards are small).
  return createPortal(
    <div className="modal-overlay" onClick={attemptClose} role="presentation">
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={attemptClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
