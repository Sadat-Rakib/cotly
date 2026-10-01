import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'ok' | 'err' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

type Push = (kind: ToastKind, text: string) => void;
const ToastCtx = createContext<Push>(() => {});

export function useToast(): Push {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback<Push>((kind, text) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
