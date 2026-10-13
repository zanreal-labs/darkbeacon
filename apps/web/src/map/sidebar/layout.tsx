'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePreference } from '../../lib/preferences';

/**
 * The system sidebar's own sections, in their default order: what a pilot reads in a fight first
 * (signatures, local), the records after. Plugin widgets follow them.
 */
export const SIDEBAR_SECTIONS = [
  { id: 'system', title: 'System' },
  { id: 'signatures', title: 'Signatures' },
  { id: 'local', title: 'Local' },
  { id: 'structures', title: 'Structures' },
  { id: 'comments', title: 'Comments' },
  { id: 'connections', title: 'Connections' },
  { id: 'kills', title: 'Kills' },
  { id: 'activity', title: 'Activity' },
  { id: 'routes', title: 'Routes' },
  { id: 'history', title: 'History' },
] as const;

/** Open until someone folds them; every other section starts folded, its title bar summing it up. */
export const DEFAULT_OPEN_SECTIONS: readonly string[] = ['signatures', 'local'];

/** Sections hidden and the order chosen (ids; absent ones keep their default place after them). */
export interface SidebarLayout {
  hidden: string[];
  order: string[];
}

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = { hidden: [], order: [] };

const isLayout = (v: unknown): v is SidebarLayout =>
  typeof v === 'object' &&
  v !== null &&
  Array.isArray((v as SidebarLayout).hidden) &&
  Array.isArray((v as SidebarLayout).order);

/** The sidebar layout, kept with my preferences (it follows me between browsers). */
export function useSidebarLayout() {
  return usePreference<SidebarLayout>('sidebar', DEFAULT_SIDEBAR_LAYOUT, isLayout);
}

/** Every section id in display order: the chosen order first, then the defaults. */
export function orderedSections(layout: SidebarLayout, extra: readonly string[] = []): string[] {
  const all = [...SIDEBAR_SECTIONS.map((s) => s.id), ...extra];
  return [
    ...layout.order.filter((id) => all.includes(id)),
    ...all.filter((id) => !layout.order.includes(id)),
  ];
}

/** Moves a section one place up (-1) or down (+1) in the full order. */
export function moveSection(layout: SidebarLayout, id: string, by: -1 | 1, extra: readonly string[] = []) {
  const order = orderedSections(layout, extra);
  const at = order.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return layout;
  [order[at], order[to]] = [order[to]!, order[at]!];
  return { ...layout, order };
}

interface Placement {
  hidden: boolean;
  order: number;
}

const LayoutContext = createContext<((id: string) => Placement) | null>(null);

/** Gives the sections inside it their place and visibility from my layout. */
export function SidebarLayoutProvider({
  extra,
  children,
}: {
  extra: readonly string[];
  children: ReactNode;
}) {
  const [layout] = useSidebarLayout();
  // Compared by content: the layout and the plugin list are new arrays on every render.
  const key = JSON.stringify([layout, extra]);
  const place = useMemo(() => {
    const [current, plugins] = JSON.parse(key) as [SidebarLayout, string[]];
    const order = orderedSections(current, plugins);
    return (id: string): Placement => ({
      hidden: current.hidden.includes(id),
      order: order.includes(id) ? order.indexOf(id) : order.length,
    });
  }, [key]);
  return <LayoutContext.Provider value={place}>{children}</LayoutContext.Provider>;
}

/** Where a section goes; outside a provider every section shows in source order. */
export function useSectionPlacement(id: string): Placement | null {
  const place = useContext(LayoutContext);
  return place ? place(id) : null;
}
