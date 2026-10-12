'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type ActivityPeriod,
  type CharacterActivityDto,
  type CharacterWalletDto,
  type EveEntityDto,
  type EveServerStatusDto,
  type MapTrackingSettingsDto,
  type MyTrackingDto,
  type OnlineCountsDto,
  type ShipTypeDto,
  type UpdateMapTrackingSettingsRequest,
} from '@darkbeacon/shared';
import { api } from './api';
import { myTrackingKey } from './session-keys';

export { myTrackingKey };

/** Query keys of the characters and tracking views. */
export const onlineCountsKey = ['online-counts'] as const;
export const eveStatusKey = ['eve-status'] as const;
export const mapTrackingSettingsKey = (mapId: string) => ['map-tracking-settings', mapId] as const;

/** My characters' whereabouts and the maps they may be tracked on. */
export function useMyTracking({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: myTrackingKey,
    queryFn: () => api<MyTrackingDto>(routes.characters.myTracking.path),
    refetchInterval: 30_000,
    enabled,
  });
}

/** Tracks or stops tracking one of my characters on a map; refreshes what depends on it. */
export function useSetTracking() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { mapId: string; characterId: number; tracked: boolean }) =>
      api<void>(buildPath(routes.tracking.set.path, { mapId: input.mapId }), {
        method: 'PUT',
        json: { characterId: input.characterId, tracked: input.tracked },
      }),
    onSettled: (_data, _error, input) => {
      void client.invalidateQueries({ queryKey: myTrackingKey });
      void client.invalidateQueries({ queryKey: ['presence', input.mapId] });
      void client.invalidateQueries({ queryKey: onlineCountsKey });
    },
  });
}

/** How many tracked characters are online per map I can see (the maps list). */
export function useOnlineCounts() {
  return useQuery({
    queryKey: onlineCountsKey,
    queryFn: () => api<OnlineCountsDto>(routes.characters.onlineCounts.path),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Tranquility's status as the server last read it. */
export function useEveStatus() {
  return useQuery({
    queryKey: eveStatusKey,
    queryFn: () => api<EveServerStatusDto>(routes.characters.eveStatus.path),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/** My main and followed character on one map, changed optimistically. */
export function useMapTrackingSettings(mapId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = mapTrackingSettingsKey(mapId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<MapTrackingSettingsDto>(buildPath(routes.characters.mapSettings.path, { mapId })),
    staleTime: Infinity,
    retry: false,
    enabled,
  });
  const update = useMutation({
    mutationFn: (patch: UpdateMapTrackingSettingsRequest) =>
      api<MapTrackingSettingsDto>(buildPath(routes.characters.updateMapSettings.path, { mapId }), {
        method: 'PUT',
        json: patch,
      }),
    onMutate: (patch) => {
      const previous = client.getQueryData<MapTrackingSettingsDto>(key);
      client.setQueryData<MapTrackingSettingsDto>(key, {
        mainCharacterId: null,
        followCharacterId: null,
        ...previous,
        ...patch,
      });
      return { previous };
    },
    onError: (_error, _patch, context) => client.setQueryData(key, context?.previous),
    onSuccess: (saved) => client.setQueryData(key, saved),
  });
  return {
    settings: query.data ?? { mainCharacterId: null, followCharacterId: null },
    loaded: query.isSuccess,
    update,
  };
}

/** Jumps and additions per character on a map over a period. */
export function useCharacterActivity(mapId: string, period: ActivityPeriod, enabled: boolean) {
  return useQuery({
    queryKey: ['character-activity', mapId, period],
    queryFn: () =>
      api<CharacterActivityDto[]>(
        `${buildPath(routes.characters.activity.path, { mapId })}?${new URLSearchParams({ period })}`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

/** A character's wallet, only asked for when it allowed it. */
export function useWallet(characterId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['wallet', characterId],
    queryFn: () => api<CharacterWalletDto>(buildPath(routes.characters.wallet.path, { characterId })),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Names and tickers of corporations, alliances and characters, by id (cached for an hour). */
export function useEveEntities(ids: readonly (number | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b);
  const query = useQuery({
    queryKey: ['eve-entities', unique.join(',')],
    queryFn: () => api<EveEntityDto[]>(`${routes.eve.entities.path}?ids=${unique.join(',')}`),
    enabled: unique.length > 0,
    staleTime: 60 * 60_000,
  });
  const byId = new Map((query.data ?? []).map((e) => [e.id, e]));
  return { byId, pending: query.isPending && unique.length > 0 };
}

/** Ship type names from the SDE (one cached request per type). */
export function useShipTypes(ids: readonly (number | null | undefined)[]): Map<number, ShipTypeDto> {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
  return useQueries({
    queries: unique.map((id) => ({
      queryKey: ['ship-type', id],
      queryFn: () => api<ShipTypeDto>(buildPath(routes.universe.getShip.path, { shipTypeId: id })),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
    combine: (results) => {
      const found = new Map<number, ShipTypeDto>();
      for (const r of results) if (r.data) found.set(r.data.id, r.data);
      return found;
    },
  });
}

/** zKillboard and EveWho pages of a character. */
export const characterLinks = (characterId: number) => ({
  zkill: `https://zkillboard.com/character/${characterId}/`,
  evewho: `https://evewho.com/character/${characterId}`,
});

export const shipIconUrl = (typeId: number) => `https://images.evetech.net/types/${typeId}/icon?size=32`;
