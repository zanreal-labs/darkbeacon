'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type ConnectionIntelDto,
  type LogPassagesRequest,
  type PassageDto,
  type RollPlanDto,
  type RollPlanRequest,
  type ShipCatalogDto,
  type ShipTypeDto,
  type UpdatePassageRequest,
} from '@darkbeacon/shared';
import { api } from '../../lib/api';
import { useStream } from '../../lib/RealtimeProvider';

/*
 * Server state of connections beyond the stream: the intel (type, mass and time estimates) and
 * the passage log. Kept fresh by the map's own events; a merged map's passages live on its
 * sources, so it also polls while a connection is open.
 */

export const intelKey = (mapId: string) => ['connection-intel', mapId] as const;
export const oneIntelKey = (mapId: string, connectionId: string) =>
  ['connection-intel', mapId, connectionId] as const;
export const passagesKey = (mapId: string, connectionId: string) =>
  ['passages', mapId, connectionId] as const;

const MERGED_POLL_MS = 30_000;

/** Every visible connection's intel (the hover card's passage count and mass used). */
export function useMapIntel(mapId: string) {
  return useQuery({
    queryKey: intelKey(mapId),
    queryFn: () => api<ConnectionIntelDto[]>(buildPath(routes.connections.intel.path, { mapId })),
    staleTime: 60_000,
    retry: false,
  });
}

export function useConnectionIntel(mapId: string, connectionId: string, merged: boolean) {
  return useQuery({
    queryKey: oneIntelKey(mapId, connectionId),
    queryFn: () =>
      api<ConnectionIntelDto>(buildPath(routes.connections.intelOne.path, { mapId, connectionId })),
    // Time left counts down even when nothing happens.
    refetchInterval: merged ? MERGED_POLL_MS : 60_000,
    enabled: !connectionId.startsWith('pending:'),
    retry: false,
  });
}

export function usePassages(mapId: string, connectionId: string, merged: boolean) {
  return useQuery({
    queryKey: passagesKey(mapId, connectionId),
    queryFn: () => api<PassageDto[]>(buildPath(routes.connections.passages.path, { mapId, connectionId })),
    refetchInterval: merged ? MERGED_POLL_MS : false,
    enabled: !connectionId.startsWith('pending:'),
    retry: false,
  });
}

/** Mass modifiers and the ships rollers use; static data, fetched once. */
export function useShipCatalog() {
  return useQuery({
    queryKey: ['ship-catalog'],
    queryFn: () => api<ShipCatalogDto>(routes.universe.shipCatalog.path),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

export function searchShips(q: string): Promise<ShipTypeDto[]> {
  return api<ShipTypeDto[]>(`${routes.universe.searchShips.path}?${new URLSearchParams({ q, limit: '12' })}`);
}

function invalidateMap(client: QueryClient, mapId: string) {
  void client.invalidateQueries({ queryKey: ['connection-intel', mapId] });
  void client.invalidateQueries({ queryKey: ['passages', mapId] });
}

const PASSAGE_EVENTS = new Set([
  'connection.passage',
  'connection.passage_updated',
  'connection.passage_removed',
  'connection.added',
  'connection.updated',
  'connection.removed',
  'signature.updated',
  'signature.removed',
]);

/**
 * Live passages: a jump recorded or logged, a mass mode changed, the counter reset or anything
 * else that moves the estimate refetches the intel and the open passage log (bursts coalesced).
 */
export function useLivePassages(mapId: string) {
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useStream(`map:${mapId}`, (message) => {
    if (message.op !== 'event' || !PASSAGE_EVENTS.has(message.event.type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => invalidateMap(client, mapId), 250);
  });
}

export function usePassageCommands(mapId: string, connectionId: string) {
  const client = useQueryClient();
  const done = () => invalidateMap(client, mapId);
  const base = { mapId, connectionId };
  return {
    log: useMutation({
      mutationFn: (body: LogPassagesRequest) =>
        api<PassageDto[]>(buildPath(routes.connections.logPassages.path, base), {
          method: 'POST',
          json: body,
        }),
      onSettled: done,
    }),
    update: useMutation({
      mutationFn: ({ passageId, body }: { passageId: string; body: UpdatePassageRequest }) =>
        api<PassageDto>(buildPath(routes.connections.updatePassage.path, { ...base, passageId }), {
          method: 'PATCH',
          json: body,
        }),
      onSettled: done,
    }),
    remove: useMutation({
      mutationFn: (passageId: string) =>
        api<void>(buildPath(routes.connections.removePassage.path, { ...base, passageId }), {
          method: 'DELETE',
        }),
      onSettled: done,
    }),
    reset: useMutation({
      mutationFn: () => api<void>(buildPath(routes.connections.resetPassages.path, base), { method: 'POST' }),
      onSettled: done,
    }),
  };
}

export function requestRollPlan(
  mapId: string,
  connectionId: string,
  body: RollPlanRequest,
): Promise<RollPlanDto> {
  return api<RollPlanDto>(buildPath(routes.connections.rollPlan.path, { mapId, connectionId }), {
    method: 'POST',
    json: body,
  });
}
