'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type AuditEntryDto,
  type AuditPageDto,
  type AuditRevertDto,
} from '@darkbeacon/shared';
import { api } from './api';

/** Filters of a history; all optional. `types` are exact types or `prefix.*`, comma separated. */
export interface HistoryFilters {
  accountId?: string;
  characterId?: number;
  solarSystemId?: number;
  connectionId?: string;
  types?: string;
  mapId?: string;
  since?: number;
}

export const historyKeys = {
  all: ['history'] as const,
  map: (mapId: string, filters: HistoryFilters = {}) => ['history', 'map', mapId, filters] as const,
  instance: (filters: HistoryFilters = {}) => ['history', 'instance', filters] as const,
};

/** `?accountId=…&types=…` from filters and extras; empty values are left out. */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The history path of a map, one of its systems or one of its connections. */
function mapPath(mapId: string, filters: HistoryFilters): string {
  if (filters.connectionId)
    return buildPath(routes.audit.connectionHistory.path, { mapId, connectionId: filters.connectionId });
  if (filters.solarSystemId)
    return buildPath(routes.audit.systemHistory.path, { mapId, solarSystemId: filters.solarSystemId });
  return buildPath(routes.audit.mapHistory.path, { mapId });
}

const PAGE = 50;

/** A map's history (or a system's, or a connection's), newest first, paged. */
export function useMapHistory(mapId: string | null, filters: HistoryFilters = {}) {
  return useInfiniteQuery({
    queryKey: historyKeys.map(mapId ?? '', filters),
    enabled: !!mapId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      // The system or connection is in the path; the rest are filters.
      const { connectionId: _c, solarSystemId: _s, ...rest } = filters;
      return api<AuditPageDto>(
        `${mapPath(mapId!, filters)}${query({ ...rest, before: pageParam, limit: PAGE })}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The instance audit (admins), newest first, paged. */
export function useInstanceAudit(filters: HistoryFilters = {}) {
  return useInfiniteQuery({
    queryKey: historyKeys.instance(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<AuditPageDto>(
        `${routes.audit.instance.path}${query({ ...filters, before: pageParam, limit: PAGE })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Every entry of the loaded pages, in order. */
export function entriesOf(pages: readonly AuditPageDto[] | undefined): AuditEntryDto[] {
  return pages?.flatMap((p) => p.entries) ?? [];
}

/** Undoes one change of a map; the server refuses (409) when it changed since. */
export function useRevertChange(mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      api<AuditRevertDto>(buildPath(routes.audit.revert.path, { mapId, eventId }), { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: historyKeys.all }),
  });
}

/** A download link of a history as CSV or JSON, with the same filters. */
export function historyExportUrl(
  mapId: string | null,
  filters: HistoryFilters,
  format: 'csv' | 'json',
): string {
  const path = mapId ? buildPath(routes.audit.mapExport.path, { mapId }) : routes.audit.instanceExport.path;
  const { connectionId: _c, ...rest } = filters;
  return `${path}${query({ ...rest, format })}`;
}
