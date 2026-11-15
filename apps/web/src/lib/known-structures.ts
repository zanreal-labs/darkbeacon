'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routes, type KnownStructureDto, type KnownStructuresDto } from '@darkbeacon/shared';
import { api } from './api';

/** The server answers for at most this many systems at once. */
const MAX_SYSTEMS = 25;

const EMPTY: ReadonlyMap<number, readonly KnownStructureDto[]> = new Map();

/**
 * Stations and Upwell structures EVE knows in these systems (NPC stations, public structures and
 * those my characters may use), by system. Not the map's own structure notes.
 */
export function useKnownStructures(systemIds: readonly number[], enabled = true) {
  const ids = useMemo(() => [...new Set(systemIds)].sort((a, b) => a - b).slice(0, MAX_SYSTEMS), [systemIds]);
  const query = useQuery({
    queryKey: ['universe', 'structures', ids.join(',')],
    queryFn: ({ signal }) =>
      api<KnownStructuresDto>(`${routes.routing.structures.path}?systems=${ids.join(',')}`, { signal }),
    enabled: enabled && ids.length > 0,
    staleTime: 15 * 60_000,
    retry: false,
  });
  const bySystem = useMemo(() => {
    if (!query.data) return EMPTY;
    const map = new Map<number, KnownStructureDto[]>();
    for (const s of query.data.structures) {
      const list = map.get(s.solarSystemId);
      if (list) list.push(s);
      else map.set(s.solarSystemId, [s]);
    }
    return map;
  }, [query.data]);
  return { bySystem, access: query.data?.access ?? null, isLoading: query.isLoading };
}

/** A structure's own name: EVE names them "<System> - <Name>", the system is already on screen. */
export function structureLabel(s: KnownStructureDto, systemName: string): string {
  const prefix = `${systemName} - `;
  return s.name.startsWith(prefix) ? s.name.slice(prefix.length) : s.name;
}
