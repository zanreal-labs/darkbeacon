'use client';

import { useMemo } from 'react';
import type { CharacterPresenceDto, MapDto } from '@darkbeacon/shared';
import { useMyTracking, useShipTypes } from '../../lib/characters';
import type { MapPermissions } from '../../lib/roles';
import { useMe } from '../../lib/session';
import { useUniverseSystems } from '../../lib/universe';
import { Card, CardBody, CardHeader, ErrorState, SkeletonRows } from '../../ui';
import { TrackingPanel } from './TrackingPanel';

/**
 * Map settings, Tracking: which of my characters this map tracks (a switch each), my main here and
 * the character the map follows, what the top bar's Track button opened before. Everyone signed
 * in has it; only members may turn tracking on.
 */
export function MapTrackingSettings({ map, can }: { map: MapDto; can: MapPermissions }) {
  const me = useMe();
  const tracking = useMyTracking({ enabled: !!me.data });
  const characters = useMemo(() => me.data?.characters ?? [], [me.data]);
  // Where each of my characters tracked here is, as the map's presence would say.
  const presence = useMemo(() => {
    const names = new Map(characters.map((c) => [c.id, c.name]));
    const out = new Map<number, CharacterPresenceDto>();
    for (const l of tracking.data?.characters ?? []) {
      if (!l.trackedOn.includes(map.id)) continue;
      out.set(l.characterId, {
        characterId: l.characterId,
        accountId: me.data?.account.id ?? '',
        name: names.get(l.characterId) ?? String(l.characterId),
        solarSystemId: l.solarSystemId,
        shipTypeId: l.shipTypeId,
        shipName: l.shipName,
        online: l.online ?? false,
        updatedAt: l.updatedAt ?? 0,
        ...(l.docked !== null ? { docked: l.docked } : {}),
      });
    }
    return out;
  }, [tracking.data, map.id, characters, me.data]);
  const universe = useUniverseSystems(
    [...presence.values()].flatMap((p) => (p.solarSystemId === null ? [] : [p.solarSystemId])),
  );
  const ships = useShipTypes([...presence.values()].map((p) => p.shipTypeId));

  return (
    <Card>
      <CardHeader
        title="Tracking on this map"
        description="Tracked characters show where they are, and their jumps map new systems and connections. Your main and the character the map follows here are yours alone."
      />
      <CardBody>
        {tracking.isPending && !!me.data ? (
          <SkeletonRows count={3} />
        ) : tracking.isError ? (
          <ErrorState compact error={tracking.error} onRetry={() => void tracking.refetch()} />
        ) : (
          <TrackingPanel
            mapId={map.id}
            myCharacters={characters}
            accountMainId={me.data?.account.mainCharacterId ?? null}
            characters={presence}
            universe={universe}
            shipName={(id) => ships.get(id)?.name}
            canTrack={can.edit}
          />
        )}
      </CardBody>
    </Card>
  );
}
