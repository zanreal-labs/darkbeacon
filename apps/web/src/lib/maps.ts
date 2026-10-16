'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { routes, type InstanceInfoDto, type MapSummaryDto, type MeDto } from '@darkbeacon/shared';
import { api } from './api';
import { instanceKey, mapsKey, meKey } from './session-keys';

/** The maps the account can see (name order), with its role on each. `enabled: false` reads none. */
export function useMaps(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: mapsKey,
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
    enabled: options.enabled ?? true,
  });
}

/** Instance facts for signed-in pages: the default map, how people sign in, the bot. */
export function useInstance() {
  return useQuery({
    queryKey: instanceKey,
    queryFn: () => api<InstanceInfoDto>(routes.instance.info.path),
    staleTime: 60_000,
  });
}

/** Stars a map as the one `/` opens (null clears it); the account copy updates at once. */
export function useSetDefaultMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mapId: string | null) =>
      api<MeDto>(routes.accounts.setDefaultMap.path, { method: 'PUT', json: { mapId } }),
    onMutate: (mapId) => {
      const before = queryClient.getQueryData<MeDto | null>(meKey);
      if (before)
        queryClient.setQueryData(meKey, { ...before, account: { ...before.account, defaultMapId: mapId } });
      return { before };
    },
    onError: (_error, _mapId, context) => context?.before && queryClient.setQueryData(meKey, context.before),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  });
}

/**
 * Remembers that this map was opened (for `/` and the map switcher's recent list). Runs once per
 * map visit; failures are ignored, the map works without it.
 */
export function useRememberMap(mapId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!mapId) return;
    const me = queryClient.getQueryData<MeDto | null>(meKey);
    if (me?.account.recentMapIds?.[0] === mapId) return;
    if (me) {
      const recent = [mapId, ...(me.account.recentMapIds ?? []).filter((id) => id !== mapId)].slice(0, 5);
      queryClient.setQueryData(meKey, { ...me, account: { ...me.account, recentMapIds: recent } });
    }
    void api<void>(routes.accounts.recordMapOpened.path, { method: 'PUT', json: { mapId } }).catch(() => {});
  }, [mapId, queryClient]);
}

/**
 * What the query cache holds for `key`, without creating the query. For the shell's parts (the
 * map switcher) that sit outside the page's HydrationBoundary: creating a query there before the
 * page hydrated it would make the page's first client render differ from the server's (see
 * docs/decisions.md). Undefined on the server and until the page filled it.
 */
export function useCachedData<T>(key: QueryKey): T | undefined {
  const client = useQueryClient();
  return useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () => client.getQueryData<T>(key),
    () => undefined,
  );
}

/** Loads the maps list when nothing has yet (the switcher opened on a page that did not fill it). */
export function useEnsureMaps() {
  const client = useQueryClient();
  return () =>
    void client
      .ensureQueryData({ queryKey: mapsKey, queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path) })
      .catch(() => undefined);
}

/** The maps in the order the switcher lists them: recently opened first, then by name. */
export function orderedMaps(maps: readonly MapSummaryDto[], recent: readonly string[] = []): MapSummaryDto[] {
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...maps].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}
