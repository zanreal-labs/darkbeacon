'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  isEventOfType,
  routes,
  type HubsDto,
  type IntelEntityDto,
  type KillmailDto,
  type MapIntelDto,
  type MapKillsDto,
  type StandingsDto,
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
export function useMapIntel(mapId: string, publicToken?: string, enabled = true): MapIntel {
  const client = useRealtime();
  const queryClient = useQueryClient();
  const status = useConnectionStatus();
  const [pulses, setPulses] = useState<ReadonlyMap<number, number>>(new Map());
  const query = useQuery({
    enabled,
    queryKey: intelKey(mapId),
    queryFn: () =>
      api<MapIntelDto>(
        publicToken
          ? buildPath(routes.intel.publicMap.path, { token: publicToken })
          : buildPath(routes.intel.map.path, { mapId }),
      ),
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });
  // A public view follows its link's stream, which carries the same intel and kills.
  const stream = publicToken ? `public:${publicToken}` : `map:${mapId}`;

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
    if (status === 'open' && enabled)
      void queryClient.invalidateQueries({ queryKey: intelKey(mapId), exact: true });
  }, [status, mapId, queryClient, enabled]);

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

export const standingsKey = ['standings'] as const;

/** The signed-in account's standings as the server gives them (with overrides and missing scopes). */
export function useStandingsQuery(enabled = true) {
  return useQuery({
    enabled,
    queryKey: standingsKey,
    queryFn: () => api<StandingsDto>(routes.intel.standings.path),
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}

/** Sets a standing by hand (null: back to contacts); the map recolours at once. */
export function useSetStanding() {
  const queryClient = useQueryClient();
  return async (entityId: number, standing: number | null) => {
    const next = await api<StandingsDto>(buildPath(routes.intel.setStanding.path, { entityId }), {
      method: 'PUT',
      json: { standing },
    });
    queryClient.setQueryData(standingsKey, next);
  };
}

/** The signed-in account's standings (its characters' contacts), id -> -10..+10. */
export function useStandings(enabled = true): ReadonlyMap<number, number> {
  const query = useStandingsQuery(enabled);
  return useMemo(() => new Map((query.data?.standings ?? []).map((s) => [s.id, s.standing])), [query.data]);
}

/** The standing towards whoever holds a system (alliance claims only; factions have none). */
export function holderStanding(
  intel: SystemIntelDto | undefined,
  standings: ReadonlyMap<number, number>,
): number | null {
  const sov = intel?.sovereignty;
  if (sov?.kind !== 'alliance') return null;
  return (
    standings.get(sov.holder.id) ?? (sov.corporation ? (standings.get(sov.corporation.id) ?? null) : null)
  );
}

/** The map's own hubs and the viewer's (trade hubs are everywhere and not marked). */
export function useRouteHubs(mapId: string, enabled = true) {
  const query = useQuery({
    enabled,
    queryKey: ['routes', mapId, 'hubs'],
    queryFn: () => api<HubsDto>(buildPath(routes.routing.hubs.path, { mapId })),
    staleTime: 5 * 60_000,
  });
  return useMemo(
    () => ({
      map: new Set((query.data?.map ?? []).map((h) => h.solarSystemId)),
      personal: new Set((query.data?.personal ?? []).map((h) => h.solarSystemId)),
    }),
    [query.data],
  );
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
