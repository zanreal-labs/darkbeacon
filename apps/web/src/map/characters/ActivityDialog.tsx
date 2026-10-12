'use client';

import { useState } from 'react';
import type { ActivityPeriod } from '@darkbeacon/shared';
import { useCharacterActivity } from '../../lib/characters';
import { CharacterAvatar, Dialog, DialogContent, ErrorState, Segmented, SkeletonRows } from '../../ui';
import styles from './characters.module.css';

const PERIODS = [
  { value: '30d', label: '30 days' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All time' },
] as const;

const count = new Intl.NumberFormat('en-US');

/** Wanderer's character activity: jumps and what each character added on this map. */
export function ActivityDialog({
  mapId,
  open,
  onOpenChange,
}: {
  mapId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [period, setPeriod] = useState<ActivityPeriod>('30d');
  const activity = useCharacterActivity(mapId, period, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Character activity"
        description="Jumps tracked on this map, and systems, connections and signatures each character added."
        width={560}
      >
        <Segmented
          aria-label="Period"
          value={period}
          onValueChange={(v) => setPeriod(v as ActivityPeriod)}
          options={PERIODS}
        />
        {activity.isPending ? (
          <SkeletonRows count={4} />
        ) : activity.isError ? (
          <ErrorState compact error={activity.error} onRetry={() => void activity.refetch()} />
        ) : activity.data.length === 0 ? (
          <p className={styles.panelEmpty}>Nothing happened on this map in this period.</p>
        ) : (
          <table className={styles.activity}>
            <thead>
              <tr>
                <th scope="col">Character</th>
                <th scope="col">Jumps</th>
                <th scope="col">Systems</th>
                <th scope="col">Connections</th>
                <th scope="col">Signatures</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.map((row) => (
                <tr key={row.characterId}>
                  <th scope="row">
                    <span className={styles.activityName}>
                      <CharacterAvatar id={row.characterId} name={row.name ?? '?'} size={20} />
                      {row.name ?? `Character ${row.characterId}`}
                    </span>
                  </th>
                  <td>{count.format(row.jumps)}</td>
                  <td>{count.format(row.systems)}</td>
                  <td>{count.format(row.connections)}</td>
                  <td>{count.format(row.signatures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
