'use client';

import { useQuery } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type ConnectionDto,
  type LinkedMapDto,
  type StreamSnapshotDto,
} from '@darkbeacon/shared';
import { api } from '../../lib/api';
import { applyMapMessage, emptyMapState } from '../mapState';

/** The other maps the viewer may open that a system is on (asked when its menu opens). */
export function useLinkedMaps(mapId: string, solarSystemId: number | null) {
  return useQuery({
    queryKey: ['linked-maps', mapId, solarSystemId],
    queryFn: () =>
      api<LinkedMapDto[]>(
        buildPath(routes.linkedMaps.elsewhere.path, { mapId, solarSystemId: solarSystemId ?? 0 }),
      ),
    enabled: solarSystemId !== null,
    staleTime: 60_000,
  });
}

/** Another map as its live snapshot has it, read once for a preview. */
export function useMapSnapshot(mapId: string | null) {
  return useQuery({
    queryKey: ['map-snapshot', mapId],
    queryFn: async () => {
      const stream = `map:${mapId}`;
      const snapshot = await api<StreamSnapshotDto>(buildPath(routes.realtime.snapshot.path, { stream }));
      return applyMapMessage(emptyMapState(), {
        op: 'snapshot',
        stream,
        seq: snapshot.seq,
        data: snapshot.data,
      });
    },
    enabled: mapId !== null,
    staleTime: 10_000,
  });
}

/**
 * The way in on another map: the fewest connections from its home to the system both maps
 * share, as the systems and connections to mark; null when they are not connected there.
 */
export function wayIn(
  connections: Iterable<ConnectionDto>,
  from: number,
  to: number,
): { systems: Set<number>; connections: Set<string> } | null {
  const links = new Map<number, Array<{ next: number; id: string }>>();
  for (const c of connections) {
    for (const [a, b] of [
      [c.source, c.target],
      [c.target, c.source],
    ] as const) {
      const list = links.get(a) ?? [];
      list.push({ next: b, id: c.id });
      links.set(a, list);
    }
  }
  const came = new Map<number, { prev: number; id: string } | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === to) break;
    for (const { next, id } of links.get(at) ?? []) {
      if (came.has(next)) continue;
      came.set(next, { prev: at, id });
      queue.push(next);
    }
  }
  if (!came.has(to)) return null;
  const systems = new Set<number>([to]);
  const ids = new Set<string>();
  for (let step = came.get(to); step; step = came.get(step.prev)) {
    ids.add(step.id);
    systems.add(step.prev);
  }
  return { systems, connections: ids };
}
