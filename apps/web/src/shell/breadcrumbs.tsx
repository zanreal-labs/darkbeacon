'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface Crumb {
  label: string;
  /** Link target; the last crumb is the current page and is not linked. */
  to?: string;
}

const Ctx = createContext<{ set(items: Crumb[] | null): void; items: Crumb[] | null } | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<Crumb[] | null>(null);
  return <Ctx.Provider value={{ items, set }}>{children}</Ctx.Provider>;
}

/** The trail a page set with `useBreadcrumbs`, or null for the default from the route. */
export function useBreadcrumbItems(): Crumb[] | null {
  return useContext(Ctx)?.items ?? null;
}

/**
 * Lets a page name itself in the top bar, e.g. `useBreadcrumbs([{ label: 'Maps', to: '/maps' },
 * { label: map.name }])`. Pass a stable value (memoised or built from primitives).
 */
export function useBreadcrumbs(items: Crumb[] | null): void {
  const ctx = useContext(Ctx);
  const key = JSON.stringify(items);
  useEffect(() => {
    if (!ctx) return;
    ctx.set(items);
    return () => ctx.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content
  }, [key]);
}
