'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  isEventOfType,
  routes,
  type IntelEntityDto,
  type KillmailDto,
  type MapIntelDto,
  type MapKillsDto,
  type SystemActivityDto,
  type SystemIntelDto,
} from '@darkbeacon/shared';
import { api } from './api';
import { useConnectionStatus, useRealtime, useStream } from './RealtimeProvider';

export const intelKey = (mapId: string) => ['intel', mapId] as const;
export const activityKey = (mapId: string, systemId: number) => ['intel', mapId, 'system', systemId] as const;
export const killsKey = (mapId: string) => ['intel', mapId, 'kills'] as const;

/** How long a node pulses after a new kill (a soft ring, never a badge that stays). */
export const PULSE_MS = 2_500;

export interface MapIntel {
  systems: ReadonlyMap<number, SystemIntelDto>;
  /** Killmails are followed live; counts are ESI's hourly ones otherwise. */
  live: boolean;
  /** Systems with a kill in the last few seconds, and when it came in. */
  pulses: ReadonlyMap<number, number>;
}

/**
 * Sovereignty and kill counts of every system on the map: loaded once, then patched by the map
 * stream's `intel` messages; a `kill.reported` event makes its system pulse and refreshes the kill
 * lists. Reloaded after a reconnect (messages sent meanwhile are lost) and every few minutes.
 */
export function useMapIntel(mapId: string): MapIntel {
  const client = useRealtime();
  const queryClient = useQueryClient();
  const status = useConnectionStatus();
  const [pulses, setPulses] = useState<ReadonlyMap<number, number>>(new Map());
  const query = useQuery({
    queryKey: intelKey(mapId),
    queryFn: () => api<MapIntelDto>(buildPath(routes.intel.map.path, { mapId })),
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });
  const stream = `map:${mapId}`;

  useEffect(
    () =>
      client.onIntel(stream, (message) => {
        queryClient.setQueryData<MapIntelDto>(intelKey(mapId), (old) => {
          if (!old) return old;
          const changed = new Map(message.systems.map((s) => [s.solarSystemId, s]));
          const systems = old.systems.map((s) => changed.get(s.solarSystemId) ?? s);
          for (const s of message.systems)
            if (!old.systems.some((o) => o.solarSystemId === s.solarSystemId)) systems.push(s);
          return { ...old, systems };
        });
      }),
    [client, stream, mapId, queryClient],
  );

  useEffect(() => {
    if (status === 'open') void queryClient.invalidateQueries({ queryKey: intelKey(mapId), exact: true });
  }, [status, mapId, queryClient]);

  useStream(stream, (message) => {
    if (message.op !== 'event' || !isEventOfType(message.event, 'kill.reported')) return;
    const kill = message.event.data;
    const at = Date.now();
    setPulses((old) => new Map(old).set(kill.solarSystemId, at));
    void queryClient.invalidateQueries({ queryKey: activityKey(mapId, kill.solarSystemId) });
    void queryClient.invalidateQueries({ queryKey: killsKey(mapId) });
  });

  // Pulses fade on their own.
  useEffect(() => {
    if (pulses.size === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setPulses((old) => new Map([...old].filter(([, at]) => now - at < PULSE_MS)));
    }, PULSE_MS);
    return () => clearTimeout(timer);
  }, [pulses]);

  const data = query.data;
  const systems = useMemo(() => new Map((data?.systems ?? []).map((s) => [s.solarSystemId, s])), [data]);
  const live = data?.live ?? false;
  return useMemo(() => ({ systems, live, pulses }), [systems, live, pulses]);
}

/** The sidebar's Activity of one system; refreshed every minute while shown. */
export function useSystemActivity(mapId: string, systemId: number) {
  return useQuery({
    queryKey: activityKey(mapId, systemId),
    queryFn: () =>
      api<SystemActivityDto>(buildPath(routes.intel.system.path, { mapId, solarSystemId: systemId })),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}

export interface KillsFilter {
  hours: number;
  /** Only these systems; undefined: every visible system of the map. */
  systems?: readonly number[];
  wormholes?: boolean;
  limit?: number;
}

export function useMapKills(mapId: string, filter: KillsFilter, enabled = true) {
  const params = new URLSearchParams({ hours: String(filter.hours), limit: String(filter.limit ?? 50) });
  if (filter.systems) params.set('systems', filter.systems.join(','));
  if (filter.wormholes) params.set('wormholes', 'true');
  return useQuery({
    queryKey: [...killsKey(mapId), params.toString()],
    queryFn: () => api<MapKillsDto>(`${buildPath(routes.intel.kills.path, { mapId })}?${params}`),
    enabled: enabled && (!filter.systems || filter.systems.length > 0),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}

// ---- Words and links -------------------------------------------------------------------------

/** "1.2b", "350m", "12k": ISK as people say it. */
export function formatIsk(value: number | null): string {
  if (value === null) return '';
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}t`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 0 : 1)}b`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}m`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(Math.round(value));
}

/** "now", "4m", "2h", "3d". */
export function ago(time: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `[TICKER]`, or the name when no ticker is known, or the fallback. */
export function groupLabel(entity: IntelEntityDto | null | undefined, fallback = 'Unknown'): string {
  if (!entity) return fallback;
  if (entity.ticker) return `[${entity.ticker}]`;
  return entity.name ?? fallback;
}

/** The group of a participant people name: the alliance, else the corporation. */
export function groupOf(p: KillmailDto['victim'] | null): IntelEntityDto | null {
  return p?.alliance ?? p?.corporation ?? null;
}

export const zkill = {
  kill: (id: number) => `https://zkillboard.com/kill/${id}/`,
  system: (id: number) => `https://zkillboard.com/system/${id}/`,
  corporation: (id: number) => `https://zkillboard.com/corporation/${id}/`,
  alliance: (id: number) => `https://zkillboard.com/alliance/${id}/`,
};

export const evewho = {
  corporation: (id: number) => `https://evewho.com/corporation/${id}`,
  alliance: (id: number) => `https://evewho.com/alliance/${id}`,
};

/** Image server (https://images.evetech.net; sizes 32-1024). */
export const images = {
  alliance: (id: number, size: 32 | 64 = 32) =>
    `https://images.evetech.net/alliances/${id}/logo?size=${size}`,
  corporation: (id: number, size: 32 | 64 = 32) =>
    `https://images.evetech.net/corporations/${id}/logo?size=${size}`,
  type: (id: number, size: 32 | 64 = 32) => `https://images.evetech.net/types/${id}/icon?size=${size}`,
};
