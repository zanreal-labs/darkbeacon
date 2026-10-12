import { vi } from 'vitest';
import { createElement, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';

/**
 * Component tests render client components without a Next.js app router: navigation hooks read
 * and change jsdom's location, links are plain anchors. Loaded for every test file (vitest.config.ts).
 * As in Next.js, `history.pushState` / `replaceState` re-render whoever reads the URL.
 */
vi.mock('next/navigation', () => {
  const listeners = new Set<() => void>();
  if (typeof window !== 'undefined') {
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = window.history[method].bind(window.history);
      window.history[method] = (...args: Parameters<History['pushState']>) => {
        original(...args);
        for (const listener of listeners) listener();
      };
    }
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener('popstate', listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('popstate', listener);
    };
  };
  const useLocation = <T,>(read: () => T) => useSyncExternalStore(subscribe, read, read);
  const go = (to: string) => window.history.pushState(null, '', to);
  const router = {
    push: vi.fn(go),
    replace: vi.fn((to: string) => window.history.replaceState(null, '', to)),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
  return {
    useRouter: () => router,
    usePathname: () => useLocation(() => window.location.pathname),
    useSearchParams: () => new URLSearchParams(useLocation(() => window.location.search)),
    useParams: () => ({}),
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown }) =>
    createElement('a', { href, ...props }),
}));
