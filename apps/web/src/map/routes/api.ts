'use client';

import { useCallback, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  DEFAULT_ROUTE_PREFERENCES,
  routeOptionsParams,
  routes,
  type CharacterDto,
  type HubDto,
  type HubRoutesDto,
  type HubsDto,
  type MapRoutingSettingsDto,
  type RouteDto,
  type RoutePreferencesDto,
  type RoutesByDto,
  type RoutesByKind,
  type StationDto,
  type TypedEvent,
  type UpdateRoutePreferencesRequest,
  type WaypointRequest,
  type WaypointsResultDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { useStream } from '../../lib/RealtimeProvider';
import type { ToastInput } from '../../ui';

/** Query keys of the routes panel; everything of one map starts with `['routes', mapId]`. */
export const routeKeys = {
  all: (mapId: string) => ['routes', mapId] as const,
  hubs: (mapId: string) => ['routes', mapId, 'hubs'] as const,
  hubRoutes: (mapId: string, from: number, list: 'map' | 'personal', params: string) =>
    ['routes', mapId, 'to-hubs', from, list, params] as const,
  by: (mapId: string, from: number, kind: RoutesByKind, highsec: boolean, params: string) =>
    ['routes', mapId, 'by', from, kind, highsec, params] as const,
  settings: (mapId: string) => ['routes', mapId, 'settings'] as const,
  preferences: ['route-preferences'] as const,
  stations: (solarSystemId: number) => ['stations', solarSystemId] as const,
};

/** Map events after which routes may differ: the chain, hubs, bridges, routing settings. */
const ROUTE_EVENTS = new Set([
  'system.added',
  'system.removed',
  'system.updated',
  'connection.added',
  'connection.updated',
  'connection.removed',
  'routes.hubs_changed',
  'routes.bridges_changed',
  'routes.settings_changed',
  'routes.exits_changed',
  // Pinged systems head the map's hubs.
  'ping.created',
  'ping.removed',
]);

/** Reloads the map's routes (debounced) when its chain, hubs or bridges change. */
export function useRouteRefresh(mapId: string) {
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useStream(`map:${mapId}`, (message) => {
    if (message.op !== 'event') return;
    const event = message.event as TypedEvent;
    if (!ROUTE_EVENTS.has(event.type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void client.invalidateQueries({ queryKey: routeKeys.all(mapId) });
    }, 400);
  });
}

/** The viewer's route options, saved on the server; changes apply at once. */
export function useRoutePreferences() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: routeKeys.preferences,
    queryFn: () => api<RoutePreferencesDto>(routes.routing.preferences.path),
    staleTime: Infinity,
  });
  const preferences = query.data ?? DEFAULT_ROUTE_PREFERENCES;
  const save = useMutation({
    mutationFn: (patch: UpdateRoutePreferencesRequest) =>
      api<RoutePreferencesDto>(routes.routing.updatePreferences.path, { method: 'PUT', json: patch }),
    onMutate: (patch) => {
      const previous = client.getQueryData<RoutePreferencesDto>(routeKeys.preferences);
      client.setQueryData(routeKeys.preferences, { ...(previous ?? DEFAULT_ROUTE_PREFERENCES), ...patch });
      return previous;
    },
    onError: (_e, _patch, previous) => client.setQueryData(routeKeys.preferences, previous),
    onSuccess: (saved) => client.setQueryData(routeKeys.preferences, saved),
  });
  return { preferences, loaded: !query.isPending, update: save.mutate };
}

/** The map's and the viewer's own hubs (trade hubs too). */
export function useHubs(mapId: string) {
  return useQuery({
    queryKey: routeKeys.hubs(mapId),
    queryFn: () => api<HubsDto>(buildPath(routes.routing.hubs.path, { mapId })),
    staleTime: 60_000,
  });
}

export function useHubRoutes(
  mapId: string,
  from: number,
  list: 'map' | 'personal',
  preferences: RoutePreferencesDto,
  enabled = true,
) {
  const params = new URLSearchParams({
    from: String(from),
    hubs: list,
    ...routeOptionsParams(pilotSafe(preferences)),
  }).toString();
  return useQuery({
    queryKey: routeKeys.hubRoutes(mapId, from, list, params),
    queryFn: () => api<HubRoutesDto>(`${buildPath(routes.routing.hubRoutes.path, { mapId })}?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export function useRoutesBy(
  mapId: string,
  from: number,
  kind: RoutesByKind,
  highsec: boolean,
  preferences: RoutePreferencesDto,
  enabled = true,
) {
  const params = new URLSearchParams({
    from: String(from),
    kind,
    ...(highsec ? { highsec: 'true' } : {}),
    ...routeOptionsParams(pilotSafe(preferences)),
  }).toString();
  return useQuery({
    queryKey: routeKeys.by(mapId, from, kind, highsec, params),
    queryFn: () => api<RoutesByDto>(`${buildPath(routes.routing.routesBy.path, { mapId })}?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

/** One route between two systems with the viewer's options (the rally card's way there). */
export function useRoute(
  mapId: string,
  from: number | null,
  to: number | null,
  preferences: RoutePreferencesDto,
  enabled = true,
) {
  const params = new URLSearchParams({
    from: String(from ?? 0),
    to: String(to ?? 0),
    ...routeOptionsParams(pilotSafe(preferences)),
  }).toString();
  return useQuery({
    queryKey: [...routeKeys.all(mapId), 'route', params] as const,
    queryFn: () => api<RouteDto>(`${buildPath(routes.routing.route.path, { mapId })}?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: enabled && from !== null && to !== null && from !== to,
  });
}

/** The pilot mode needs a character; without one the shortest way is asked for. */
function pilotSafe(p: RoutePreferencesDto): RoutePreferencesDto {
  return p.mode === 'pilot' && p.characterId === null ? { ...p, mode: 'shortest' } : p;
}

export function useMapRoutingSettings(mapId: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: routeKeys.settings(mapId),
    queryFn: () => api<MapRoutingSettingsDto>(buildPath(routes.routing.mapSettings.path, { mapId })),
  });
  const save = useMutation({
    mutationFn: (patch: Partial<MapRoutingSettingsDto>) =>
      api<MapRoutingSettingsDto>(buildPath(routes.routing.updateMapSettings.path, { mapId }), {
        method: 'PATCH',
        json: patch,
      }),
    onSuccess: (saved) => client.setQueryData(routeKeys.settings(mapId), saved),
  });
  return { settings: query.data, save };
}

export function useStations(solarSystemId: number | null) {
  return useQuery({
    queryKey: routeKeys.stations(solarSystemId ?? 0),
    queryFn: () =>
      api<StationDto[]>(buildPath(routes.routing.stations.path, { solarSystemId: solarSystemId! })),
    enabled: solarSystemId !== null,
    staleTime: Infinity,
  });
}

/** Adds a system to or removes it from the map's or the viewer's own hubs. */
export function useHubToggle(mapId: string, notify?: (toast: ToastInput) => void) {
  const client = useQueryClient();
  return useCallback(
    async (list: 'map' | 'personal', hub: { solarSystemId: number; name: string }, on: boolean) => {
      const current =
        client.getQueryData<HubsDto>(routeKeys.hubs(mapId)) ??
        (await api<HubsDto>(buildPath(routes.routing.hubs.path, { mapId })));
      const ids = current[list].map((h: HubDto) => h.solarSystemId).filter((id) => id !== hub.solarSystemId);
      const next = on ? [...ids, hub.solarSystemId] : ids;
      try {
        await api(
          list === 'map'
            ? buildPath(routes.routing.setMapHubs.path, { mapId })
            : routes.routing.setPersonalHubs.path,
          { method: 'PUT', json: { solarSystemIds: next } },
        );
        await client.invalidateQueries({ queryKey: routeKeys.all(mapId) });
        notify?.({
          title: on
            ? `${hub.name} added to ${list === 'map' ? "the map's" : 'your'} hubs`
            : `${hub.name} removed from ${list === 'map' ? "the map's" : 'your'} hubs`,
          tone: 'success',
          duration: 2500,
        });
      } catch (error) {
        notify?.({
          title: list === 'map' ? 'The map hubs did not change' : 'Your hubs did not change',
          description: error instanceof ApiError ? error.message : 'Network error',
          tone: 'danger',
        });
      }
    },
    [client, mapId, notify],
  );
}

export type WaypointMode = WaypointRequest['mode'];

const WAYPOINT_DONE: Record<WaypointMode, (name: string) => string> = {
  destination: (name) => `Destination set to ${name}`,
  waypoint: (name) => `${name} added as a waypoint`,
  front: (name) => `${name} put first on the route`,
};

/**
 * Sends a destination or waypoint (a system or a station in it) to one character, or to every
 * own character that may when `character` is 'all'.
 */
export async function sendWaypoint(
  character: CharacterDto | 'all',
  target: { solarSystemId: number; stationId?: number; name: string },
  mode: WaypointMode,
  notify?: (toast: ToastInput) => void,
) {
  const body = {
    solarSystemId: target.solarSystemId,
    mode,
    ...(target.stationId ? { stationId: target.stationId } : {}),
  };
  try {
    if (character === 'all') {
      const { results } = await api<WaypointsResultDto>(routes.routing.waypoints.path, {
        method: 'POST',
        json: body,
      });
      const failed = results.filter((r) => !r.ok);
      notify?.({
        title: WAYPOINT_DONE[mode](target.name),
        description:
          failed.length === 0
            ? `For ${results.length} character${results.length === 1 ? '' : 's'}.`
            : `Not for ${failed.map((r) => r.name).join(', ')}: ${failed[0]!.message ?? 'refused'}`,
        tone: failed.length === results.length ? 'danger' : 'success',
      });
      return;
    }
    await api<void>(buildPath(routes.routing.waypoint.path, { characterId: String(character.id) }), {
      method: 'POST',
      json: body,
    });
    notify?.({ title: WAYPOINT_DONE[mode](target.name), description: character.name, tone: 'success' });
  } catch (error) {
    notify?.({
      title: mode === 'destination' ? 'Could not set the destination' : 'Could not add the waypoint',
      description: error instanceof ApiError ? error.message : undefined,
      tone: 'danger',
    });
  }
}

/** What the map's context menu needs for its hub toggles. */
export function useHubMenu(mapId: string, canEdit: boolean, notify?: (toast: ToastInput) => void) {
  const hubs = useHubs(mapId);
  const toggle = useHubToggle(mapId, notify);
  return { hubs: hubs.data, canEdit, toggle };
}
