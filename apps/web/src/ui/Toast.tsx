import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Toast as T } from 'radix-ui';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { IconButton } from './Button';
import styles from './overlay.module.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds; errors stay longer by default. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  open: boolean;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

const ICONS: Record<ToastTone, ReactNode> = {
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <XCircle />,
};

/** Wrap the app once; `useToast()` then shows short notices in the bottom corner. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((toast: ToastInput) => {
    setToasts((list) => [...list.slice(-3), { ...toast, id: Date.now() + Math.random(), open: true }]);
  }, []);
  const close = (id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, open: false } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 300);
  };
  return (
    <ToastContext.Provider value={show}>
      <T.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => {
          const tone = t.tone ?? 'info';
          return (
            <T.Root
              key={t.id}
              className={styles.toast}
              data-tone={tone}
              open={t.open}
              duration={t.duration ?? (tone === 'danger' ? 8000 : 4000)}
              type={tone === 'danger' ? 'foreground' : 'background'}
              onOpenChange={(open) => !open && close(t.id)}
            >
              <span className={styles.toastIcon} aria-hidden>
                {ICONS[tone]}
              </span>
              <T.Title className={styles.toastTitle}>{t.title}</T.Title>
              <T.Close asChild>
                <IconButton label="Dismiss" icon={<X />} size="sm" tooltip={false} />
              </T.Close>
              {t.description && (
                <T.Description className={styles.toastDescription}>{t.description}</T.Description>
              )}
            </T.Root>
          );
        })}
        <T.Viewport className={styles.toastViewport} />
      </T.Provider>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast({ title: 'Saved', tone: 'success' })` */
export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  return useMemo(() => show ?? (() => {}), [show]);
}
