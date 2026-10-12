'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type CreatePingInput,
  type MapPingDto,
  type TypedEvent,
} from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/RealtimeProvider';
import type { ToastInput } from '../../ui';

export const pingKeys = { map: (mapId: string) => ['pings', mapId] as const };

/**
 * The map's rally pings, kept current by `ping.*` events; `onNew` hears pings called after the
 * view opened (for the toast). Viewers and up read them.
 */
export function usePings(mapId: string, onNew?: (ping: MapPingDto) => void, enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: pingKeys.map(mapId),
    queryFn: () => api<MapPingDto[]>(buildPath(routes.pings.list.path, { mapId })),
    staleTime: 60_000,
    enabled,
  });
  useStream(enabled ? `map:${mapId}` : null, (message) => {
    if (message.op !== 'event') return;
    const event = message.event as TypedEvent;
    if (event.type === 'ping.created') {
      const ping = event.data as MapPingDto;
      client.setQueryData<MapPingDto[]>(pingKeys.map(mapId), (list = []) => [
        ...list.filter((p) => p.id !== ping.id),
        ping,
      ]);
      onNew?.(ping);
    } else if (event.type === 'ping.removed') {
      const { id } = event.data as { id: string };
      client.setQueryData<MapPingDto[]>(pingKeys.map(mapId), (list = []) => list.filter((p) => p.id !== id));
    } else if (event.type === 'map.sources_changed') {
      void client.invalidateQueries({ queryKey: pingKeys.map(mapId) });
    }
  });
  const pings = query.data;
  const pinged = useMemo(() => new Set((pings ?? []).map((p) => p.solarSystemId)), [pings]);
  return { pings: pings ?? [], pinged };
}

/** Calling and cancelling pings, with a toast when the server refuses. */
export function usePingCommands(mapId: string, notify: (toast: ToastInput) => void) {
  const client = useQueryClient();
  const call = useCallback(
    async (request: CreatePingInput) => {
      try {
        const ping = await api<MapPingDto>(buildPath(routes.pings.create.path, { mapId }), {
          method: 'POST',
          json: request,
        });
        client.setQueryData<MapPingDto[]>(pingKeys.map(mapId), [ping]);
      } catch (error) {
        notify({
          title: 'Could not call the rally',
          description: error instanceof ApiError ? error.message : 'Network error',
          tone: 'danger',
        });
      }
    },
    [client, mapId, notify],
  );
  const cancel = useCallback(
    async (pingId: string) => {
      try {
        await api(buildPath(routes.pings.remove.path, { mapId, pingId }), { method: 'DELETE' });
        client.setQueryData<MapPingDto[]>(pingKeys.map(mapId), (list = []) =>
          list.filter((p) => p.id !== pingId),
        );
      } catch (error) {
        notify({
          title: 'Could not cancel the rally',
          description: error instanceof ApiError ? error.message : 'Network error',
          tone: 'danger',
        });
      }
    },
    [client, mapId, notify],
  );
  return { call, cancel };
}
