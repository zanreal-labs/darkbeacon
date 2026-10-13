'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TypedEvent } from '@darkbeacon/shared';
import { api } from '../../lib/api';
import { useStream } from '../../lib/RealtimeProvider';

interface Item {
  id: string;
  solarSystemId: number;
}

/**
 * A per-system list loaded over REST (comments, structures) and kept live from the map's stream:
 * `added`/`updated` events upsert, `removed` events drop, for this system only. `order` sorts
 * the list after a change.
 */
export function useSystemList<T extends Item>({
  key,
  path,
  mapId,
  solarSystemId,
  events,
  order,
}: {
  key: string;
  path: string;
  mapId: string;
  solarSystemId: number;
  events: { upsert: readonly string[]; remove: string };
  order(a: T, b: T): number;
}) {
  const queryClient = useQueryClient();
  const queryKey = [key, mapId, solarSystemId];
  const query = useQuery({ queryKey, queryFn: () => api<T[]>(path) });

  useStream(`map:${mapId}`, (message) => {
    if (message.op !== 'event') return;
    const event = message.event as TypedEvent;
    const data = event.data as Partial<Item> | undefined;
    if (!data || data.solarSystemId !== solarSystemId) return;
    if (events.upsert.includes(event.type)) {
      const item = data as T;
      queryClient.setQueryData<T[]>(queryKey, (list) =>
        [...(list ?? []).filter((x) => x.id !== item.id), item].sort(order),
      );
    } else if (event.type === events.remove) {
      queryClient.setQueryData<T[]>(queryKey, (list) => list?.filter((x) => x.id !== data.id));
    }
  });

  return query;
}
