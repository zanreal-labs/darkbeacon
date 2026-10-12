'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ReactFlowProvider } from '@xyflow/react';
import type { LinkedMapDto } from '@darkbeacon/shared';
import { ArrowUpRight } from 'lucide-react';
import { mapPermissions } from '../../lib/roles';
import { useUniverseSystems } from '../../lib/universe';
import { Button, Dialog, DialogContent, Spinner } from '../../ui';
import { MapCanvas } from '../MapCanvas';
import { systemDisplayName } from '../SystemNode';
import { useMapSnapshot, wayIn } from './api';
import styles from './linked.module.css';

const VIEWER = mapPermissions('viewer');

/**
 * Another map a system is on, read only (Wanderer's "Also on <map>"): it opens on the shared
 * system, and when that map has a home, the way in from there is marked.
 */
export function LinkedMapPreview({
  linked,
  solarSystemId,
  onClose,
}: {
  linked: LinkedMapDto;
  solarSystemId: number;
  onClose(): void;
}) {
  const snapshot = useMapSnapshot(linked.mapId);
  const state = snapshot.data;
  const ids = useMemo(() => (state ? [...state.systems.keys()] : []), [state]);
  const universe = useUniverseSystems(ids);
  const way = useMemo(
    () =>
      state && linked.home !== null && linked.home !== solarSystemId
        ? wayIn(state.connections.values(), linked.home, solarSystemId)
        : null,
    [state, linked.home, solarSystemId],
  );
  const highlight = useMemo(
    () => way ?? { systems: new Set([solarSystemId]), connections: new Set<string>() },
    [way, solarSystemId],
  );
  const name = (id: number) => {
    const sys = state?.systems.get(id);
    return sys ? systemDisplayName(sys, universe.get(id)) : (universe.get(id)?.name ?? 'the system');
  };
  const description =
    linked.home === null
      ? `${name(solarSystemId)} on ${linked.name}, read only.`
      : linked.home === solarSystemId
        ? `${name(solarSystemId)} is the home of ${linked.name}.`
        : way
          ? `The way in from ${name(linked.home)}, home of ${linked.name}: ${way.connections.size} jump${way.connections.size === 1 ? '' : 's'} on that map.`
          : `${linked.name} does not connect ${name(solarSystemId)} to its home ${name(linked.home)}.`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={linked.name} description={description} width={1040}>
        <div className={styles.frame}>
          {state ? (
            <ReactFlowProvider>
              <MapCanvas
                mapId={linked.mapId}
                state={state}
                loaded
                labels={state.map?.labels ?? []}
                systemLabels={state.map?.systemLabels ?? []}
                universe={universe}
                can={VIEWER}
                store={{ moveSystems: async () => false, addConnection: async () => false }}
                onSelect={() => {}}
                focus={null}
                onMenu={() => {}}
                readOnly
                highlight={highlight}
                openOn={solarSystemId}
              />
            </ReactFlowProvider>
          ) : (
            <div className={styles.loading} role="status">
              <Spinner label="Loading the map" />
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <Button asChild variant="secondary" icon={<ArrowUpRight />}>
            <Link href={`/m/${linked.slug}`}>Open {linked.name}</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
