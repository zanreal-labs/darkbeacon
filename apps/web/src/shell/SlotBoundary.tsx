'use client';

import { Component, type ReactNode } from 'react';

/** Next.js signals redirects and not-found pages with errors; those must reach its own boundaries. */
function isNavigation(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

/**
 * Keeps the shell when one of its streamed parts fails (the API answered 5xx or something it
 * should not): that part shows `fallback` instead of the whole document turning into an error
 * page. The page below has its own boundary with a retry; once the layout renders again (a
 * refresh), the part is tried again.
 */
export class SlotBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { error: unknown; failed: boolean }
> {
  override state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  override componentDidUpdate(previous: { children: ReactNode }): void {
    if (this.state.failed && previous.children !== this.props.children)
      this.setState({ error: null, failed: false });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (isNavigation(this.state.error)) throw this.state.error;
    return this.props.fallback;
  }
}
