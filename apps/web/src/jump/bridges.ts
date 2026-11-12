'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { buildPath, routes, type BridgeDto } from '@darkbeacon/shared';
import { api } from '../lib/api';
import { useMaps } from '../lib/maps';

/** A bridge as the planner takes it: either end first, it is used both ways. */
export interface PlannerBridge {
  from: number;
  to: number;
}

const EMPTY: PlannerBridge[] = [];

/** Outside the hook, so the combined lists keep their identity between renders. */
const dataOf = (answers: ReadonlyArray<{ data?: BridgeDto[] }>) => answers.map((a) => a.data);

/**
 * The Ansiblex bridges of every map I can see, once each and without ones marked
 * dangerous: what the maps route over, the jump planner uses too. Asked for only when `wanted`
 * (a ship that may take Ansiblex).
 */
export function useMapBridges(wanted: boolean): PlannerBridge[] {
  const maps = useMaps({ enabled: wanted });
  // `combine` keeps the same array while no answer changes, so the bridges below follow it.
  const lists = useQueries({
    queries: (wanted ? (maps.data ?? []) : []).map((map) => ({
      queryKey: ['maps', map.id, 'bridges'],
      queryFn: () => api<BridgeDto[]>(buildPath(routes.bridges.list.path, { mapId: map.id })),
      staleTime: 5 * 60_000,
      retry: false,
    })),
    combine: dataOf,
  });
  return useMemo(() => {
    if (!wanted) return EMPTY;
    const seen = new Set<string>();
    const pairs: PlannerBridge[] = [];
    for (const list of lists)
      for (const bridge of list ?? []) {
        if (bridge.dangerous) continue;
        const key = `${bridge.a.solarSystemId}:${bridge.b.solarSystemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ from: bridge.a.solarSystemId, to: bridge.b.solarSystemId });
      }
    return pairs;
  }, [wanted, lists]);
}
