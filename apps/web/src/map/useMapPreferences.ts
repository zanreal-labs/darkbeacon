'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type MapPreferencesDto,
  type UpdateMapPreferencesRequest,
} from '@darkbeacon/shared';
import { api } from '../lib/api';
import { mapPreferencesKey } from '../lib/session-keys';

const EMPTY: MapPreferencesDto = {
  viewport: null,
  bookmarkTemplate: null,
  bookmarkOrder: null,
  updatedAt: 0,
};

/**
 * The viewer's own view of a map, kept on the server per account: the last viewport and the
 * bookmark template and order overrides. Updates apply at once and are rolled back if the server refuses.
 * `enabled: false` (public views, no account) never asks the server and counts as settled.
 */
export function useMapPreferences(mapId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = mapPreferencesKey(mapId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<MapPreferencesDto>(buildPath(routes.maps.getPreferences.path, { mapId })),
    staleTime: Infinity,
    retry: false,
    enabled,
  });

  const update = useCallback(
    async (patch: UpdateMapPreferencesRequest): Promise<MapPreferencesDto> => {
      const previous = client.getQueryData<MapPreferencesDto>(mapPreferencesKey(mapId));
      client.setQueryData<MapPreferencesDto>(mapPreferencesKey(mapId), { ...EMPTY, ...previous, ...patch });
      try {
        const saved = await api<MapPreferencesDto>(buildPath(routes.maps.updatePreferences.path, { mapId }), {
          method: 'PATCH',
          json: patch,
        });
        client.setQueryData(mapPreferencesKey(mapId), saved);
        return saved;
      } catch (error) {
        client.setQueryData(mapPreferencesKey(mapId), previous);
        throw error;
      }
    },
    [client, mapId],
  );

  return {
    preferences: query.data ?? EMPTY,
    /** True once the server answered (or failed): the first view waits for it. */
    settled: !enabled || !query.isPending,
    update,
  };
}
