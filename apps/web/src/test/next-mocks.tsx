import { vi } from 'vitest';
import { createElement, type AnchorHTMLAttributes } from 'react';

/**
 * Component tests render client components without a Next.js app router: navigation hooks read
 * and change jsdom's location, links are plain anchors. Loaded for every test file (vitest.config.ts).
 */
vi.mock('next/navigation', () => {
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
    usePathname: () => window.location.pathname,
    useSearchParams: () => new URLSearchParams(window.location.search),
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
