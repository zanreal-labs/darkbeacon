'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  chainFromHome,
  routes,
  type ChainPresenceListDto,
  type ConnectionDto,
  type MapSystemDto,
} from '@darkbeacon/shared';
import { api } from './api';
import { relativeTime } from './time';

/**
 * Where a system stands in the map's chain from home: in it now (since when, when the record
 * knows, and when it was last in it before: `before`, null when this is its first time since
 * `recordedSince`), out of it since `at` (null: it left a moment ago and the record is catching
 * up), or never in it since the map began recording (`recordedSince`).
 */
export type ChainPresence =
  | { kind: 'now'; since: number | null; before: number | null; recordedSince: number | null }
  | { kind: 'past'; at: number | null }
  | { kind: 'never'; recordedSince: number | null };

/** Looks a system up; changes whenever the chain or the record does. */
export type ChainPresenceLookup = (solarSystemId: number) => ChainPresence;

/** How long the server takes to record a change of the chain before it is asked again. */
const RECORD_DELAY_MS = 1_500;

/**
 * The chain from home as the map shows it now (worked out here, so "in the chain now" is live)
 * and the map's record of when systems were last in it (asked again shortly after the chain
 * changes, once the server has recorded the change).
 */
export function useChainPresence(
  mapId: string,
  systems: ReadonlyMap<number, MapSystemDto>,
  connections: ReadonlyMap<string, ConnectionDto>,
): ChainPresenceLookup {
  const live = useMemo(() => chainFromHome(systems.values(), connections.values()), [systems, connections]);
  const members = useMemo(() => [...live].sort((a, b) => a - b).join(','), [live]);
  const queryKey = useMemo(() => ['chain-presence', mapId], [mapId]);
  const record = useQuery({
    queryKey,
    queryFn: () => api<ChainPresenceListDto>(buildPath(routes.chainPresence.list.path, { mapId })),
    staleTime: 5 * 60_000,
  });
  const queryClient = useQueryClient();
  const seen = useRef(members);
  useEffect(() => {
    if (seen.current === members) return;
    seen.current = members;
    const timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey }), RECORD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [members, queryClient, queryKey]);

  const rows = useMemo(
    () => new Map((record.data?.systems ?? []).map((s) => [s.solarSystemId, s])),
    [record.data],
  );
  const recordedSince = record.data?.recordedSince ?? null;
  return useCallback(
    (solarSystemId: number): ChainPresence => {
      const row = rows.get(solarSystemId);
      if (live.has(solarSystemId)) {
        // The record holds this stint already (left null), or not yet: then its last stint ended
        // at `leftAt`, which is the one before this.
        if (row && row.leftAt === null)
          return { kind: 'now', since: row.joinedAt, before: row.previousLeftAt, recordedSince };
        return { kind: 'now', since: null, before: row?.leftAt ?? null, recordedSince };
      }
      if (row) return { kind: 'past', at: row.leftAt };
      return { kind: 'never', recordedSince };
    },
    [live, rows, recordedSince],
  );
}

const date = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * "Last in our chain 3 d ago", with the moment itself for a tooltip. A system in the chain now
 * says when it was there before this time, not "now".
 */
export function chainPresenceText(
  presence: ChainPresence,
  now = Date.now(),
): { text: string; title: string | undefined } {
  switch (presence.kind) {
    case 'now': {
      // The stint going on now does not count: say when it was in the chain before.
      const since =
        presence.since === null
          ? 'In the chain from home now'
          : `In the chain from home since ${date(presence.since)}`;
      return presence.before === null
        ? {
            text: 'Never in our chain before',
            title:
              presence.recordedSince === null
                ? since
                : `${since}; recorded since ${date(presence.recordedSince)}`,
          }
        : {
            text: `Last in our chain ${relativeTime(presence.before, now)}`,
            title: `${date(presence.before)} (${since.charAt(0).toLowerCase()}${since.slice(1)})`,
          };
    }
    case 'past':
      return presence.at === null
        ? { text: 'Last in our chain just now', title: undefined }
        : { text: `Last in our chain ${relativeTime(presence.at, now)}`, title: date(presence.at) };
    case 'never':
      return {
        text: 'Never in our chain',
        title:
          presence.recordedSince === null
            ? 'Nothing recorded yet'
            : `Recorded since ${date(presence.recordedSince)}`,
      };
  }
}

/** "In chain 4 d ago" for the search: only systems the chain held before and holds no more. */
export function chainPresenceHint(presence: ChainPresence, now = Date.now()): string | null {
  if (presence.kind !== 'past' || presence.at === null) return null;
  return `In chain ${relativeTime(presence.at, now)}`;
}
