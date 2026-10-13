'use client';

import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, Undo2 } from 'lucide-react';
import type { UniverseSystemDto } from '@darkbeacon/shared';
import { readEntry } from '../../lib/audit';
import { ApiError } from '../../lib/api';
import { entriesOf, historyKeys, useMapHistory, useRevertChange } from '../../lib/history';
import { useStream } from '../../lib/RealtimeProvider';
import type { MapPermissions } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { Button, IconButton, Skeleton, useToast } from '../../ui';
import { WidgetWindow } from './WidgetWindow';
import styles from './widgets.module.css';
import own from './records.module.css';

/**
 * What happened in the system, newest first: the system itself, its signatures, the connections
 * touching it, comments and structures, by whom. Members can put back one change when nothing
 * changed it since. Loaded only while the widget is shown (it is off by default).
 */
export function HistorySection({
  mapId,
  solarSystemId,
  universe,
  can,
}: {
  mapId: string;
  solarSystemId: number;
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
}) {
  return (
    <WidgetWindow id="history" title="History">
      <HistoryList mapId={mapId} solarSystemId={solarSystemId} universe={universe} can={can} />
    </WidgetWindow>
  );
}

function HistoryList({
  mapId,
  solarSystemId,
  universe,
  can,
}: {
  mapId: string;
  solarSystemId: number;
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const history = useMapHistory(mapId, { solarSystemId });
  const revert = useRevertChange(mapId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New changes on the map: read the history again, at most every two seconds.
  useStream(`map:${mapId}`, (message) => {
    if (message.op !== 'event' || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: historyKeys.map(mapId, { solarSystemId }) });
    }, 2000);
  });

  const names = { system: (id: number) => universe.get(id)?.name };
  const entries = entriesOf(history.data?.pages).filter(
    (e) => !e.type.startsWith('character.') && e.type !== 'connection.passage',
  );

  if (history.isPending) return <Skeleton height={14} width="80%" />;
  if (entries.length === 0)
    return (
      <p className={styles.empty}>
        <History aria-hidden />
        Nothing recorded here yet.
      </p>
    );
  return (
    <>
      <ul className={own.history}>
        {entries.map((entry) => {
          const reading = readEntry(entry, names);
          return (
            <li
              key={entry.id}
              className={own.historyItem}
              data-reverted={entry.revertedBy ? true : undefined}
            >
              <div className={own.historyHead}>
                <span>
                  <strong>{reading.who}</strong> {reading.what}
                </span>
                <time className={own.when} title={new Date(entry.occurredAt).toLocaleString()}>
                  {relativeTime(entry.occurredAt)}
                </time>
                {can.edit && entry.revertible && !entry.revertedBy && (
                  <IconButton
                    size="sm"
                    tooltipSide="left"
                    className={own.remove}
                    label="Undo this change"
                    icon={<Undo2 />}
                    loading={revert.isPending && revert.variables === entry.id}
                    onClick={() =>
                      revert.mutate(entry.id, {
                        onError: (error) =>
                          toast({
                            title: 'Could not undo',
                            description: error instanceof ApiError ? error.message : 'Network error',
                            tone: 'danger',
                          }),
                      })
                    }
                  />
                )}
              </div>
              {/* What was added or removed is in the sentence; field lists are for changes. */}
              {entry.op === 'update' && reading.changes.length > 0 && (
                <ul className={own.changes}>
                  {reading.changes.slice(0, 4).map((c) => (
                    <li key={c.label}>
                      {c.label}: {c.before}
                      {c.after && <> → {c.after}</>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {history.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Show older
        </Button>
      )}
    </>
  );
}
