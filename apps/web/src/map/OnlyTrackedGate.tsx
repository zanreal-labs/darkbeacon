'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Radio } from 'lucide-react';
import { buildPath, routes, type CharacterDto, type MapDto } from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import type { MapPermissions } from '../lib/roles';
import { Button, Card, EmptyState } from '../ui';
import styles from './OnlyTrackedGate.module.css';

/** The characters of mine the map still needs tracked (empty: the map may open). */
export function untrackedOf(
  map: MapDto,
  can: MapPermissions,
  mine: readonly CharacterDto[],
  tracked: ReadonlySet<number>,
): CharacterDto[] {
  // Admins pass, so whoever set the option can always open the map and change it.
  if (!map.settings.onlyTrackedCharacters || can.admin) return [];
  return mine.filter((c) => !tracked.has(c.id));
}

/**
 * Wanderer's "only tracked characters": the map opens once every character of the person is
 * tracked on it. Viewers cannot track, so the map stays closed to them.
 */
export function OnlyTrackedGate({
  map,
  can,
  untracked,
}: {
  map: MapDto;
  can: MapPermissions;
  untracked: readonly CharacterDto[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackAll = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const c of untracked)
        await api(buildPath(routes.tracking.set.path, { mapId: map.id }), {
          method: 'PUT',
          json: { characterId: c.id, tracked: true },
        });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tracking did not start. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.gate} role="dialog" aria-modal="true" aria-label="Track your characters">
      <Card className={styles.card}>
        <EmptyState
          icon={<Radio />}
          title={
            can.edit ? 'Track all your characters to open this map' : 'This map needs tracked characters'
          }
          description={
            can.edit
              ? `${map.name} opens only once every character of yours is tracked on it. Not yet: ${untracked
                  .map((c) => c.name)
                  .join(', ')}.${error ? ` ${error}` : ''}`
              : `${map.name} opens only for people who track their characters on it, and viewers cannot track. Ask a map admin for member access.`
          }
          actions={
            <>
              <Button asChild variant="ghost">
                <Link href="/maps">All maps</Link>
              </Button>
              {can.edit && (
                <Button variant="primary" icon={<Radio />} loading={busy} onClick={() => void trackAll()}>
                  Track all
                </Button>
              )}
            </>
          }
        />
      </Card>
    </div>
  );
}
