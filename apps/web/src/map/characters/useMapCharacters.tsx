'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { MapDto } from '@darkbeacon/shared';
import { useMapTrackingSettings, useShipTypes } from '../../lib/characters';
import type { MapPermissions } from '../../lib/roles';
import { useMe } from '../../lib/session';
import { useUniverseSystems } from '../../lib/universe';
import type { MapState } from '../mapState';
import { CharacterBar, ownOnMap } from './CharacterBar';
import { TrackingDialog } from './TrackingDialog';
import { useFollowCharacter } from './useFollow';

/**
 * Everything about characters the map view mounts: the top bar's strip with tracking and On the
 * map, the tracking dialog (also opened from an empty map), and follow mode, which selects and
 * centres the followed character's system whenever it jumps.
 */
export function useMapCharacters({
  map,
  can,
  state,
  select,
}: {
  map: MapDto;
  can: MapPermissions;
  state: Pick<MapState, 'characters'>;
  select(solarSystemId: number): void;
}): { bar: ReactNode; dialog: ReactNode; openTracking(): void } {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const signedIn = !!me.data;
  const { settings } = useMapTrackingSettings(map.id, { enabled: signedIn });
  const myCharacters = useMemo(() => me.data?.characters ?? [], [me.data]);
  const accountMain = me.data?.account.mainCharacterId ?? null;
  const main = settings.mainCharacterId ?? accountMain;

  const presence = state.characters;
  const systemIds = useMemo(
    () => [
      ...new Set([...presence.values()].flatMap((c) => (c.solarSystemId === null ? [] : [c.solarSystemId]))),
    ],
    [presence],
  );
  const universe = useUniverseSystems(systemIds);
  const ships = useShipTypes([...presence.values()].map((c) => c.shipTypeId));
  const shipName = (typeId: number) => ships.get(typeId)?.name;

  useFollowCharacter(presence, settings.followCharacterId, select);

  if (!signedIn) return { bar: null, dialog: null, openTracking: () => undefined };
  const own = ownOnMap(myCharacters, presence, main, settings.followCharacterId);
  return {
    bar: (
      <CharacterBar
        mapId={map.id}
        own={own}
        hasCharacters={myCharacters.length > 0 || can.edit}
        characters={presence}
        universe={universe}
        shipName={shipName}
        canSeeAll={can.edit}
        onCenter={select}
        onOpenTracking={() => setOpen(true)}
      />
    ),
    dialog: (
      <TrackingDialog
        mapId={map.id}
        open={open}
        onOpenChange={setOpen}
        myCharacters={myCharacters}
        accountMainId={accountMain}
        characters={presence}
        universe={universe}
        shipName={shipName}
        canTrack={can.edit}
      />
    ),
    openTracking: () => setOpen(true),
  };
}
