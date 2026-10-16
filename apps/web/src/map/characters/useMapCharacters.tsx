'use client';

import { useMemo, type ReactNode } from 'react';
import type { MapDto, TrackingProblemDto } from '@darkbeacon/shared';
import { useMapTrackingSettings, useMyTracking, useShipTypes } from '../../lib/characters';
import type { MapPermissions } from '../../lib/roles';
import { useMe } from '../../lib/session';
import { useUniverseSystems } from '../../lib/universe';
import type { MapState } from '../mapState';
import { CharacterBar, ownOnMap } from './CharacterBar';
import { useFollowCharacter } from './useFollow';

/**
 * Everything about characters the map view mounts: the top bar's strip with my characters, the
 * quick views (`views`, where the tracking button was) and On the map, and follow mode, which
 * selects and centres the followed character's system whenever it jumps. Tracking itself is in
 * the map's settings (`openTracking`).
 */
export function useMapCharacters({
  map,
  can,
  state,
  select,
  openTracking,
  views,
}: {
  map: MapDto;
  can: MapPermissions;
  state: Pick<MapState, 'characters'> & Partial<Pick<MapState, 'systems'>>;
  select(solarSystemId: number): void;
  openTracking(): void;
  views?: ReactNode;
}): { bar: ReactNode } {
  const me = useMe();
  const signedIn = !!me.data;
  const { settings, loaded: settingsLoaded } = useMapTrackingSettings(map.id, { enabled: signedIn });
  const myCharacters = useMemo(() => me.data?.characters ?? [], [me.data]);
  const accountMain = me.data?.account.mainCharacterId ?? null;
  const main = settings.mainCharacterId ?? accountMain;
  // What stops tracking from reading where my characters are (the top bar's mark).
  const tracking = useMyTracking({ enabled: signedIn });
  const problems = useMemo(() => {
    const out = new Map<number, TrackingProblemDto>();
    for (const c of tracking.data?.characters ?? []) if (c.problem) out.set(c.characterId, c.problem);
    return out;
  }, [tracking.data]);

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

  const systems = state.systems;
  useFollowCharacter(presence, settings.followCharacterId, select, {
    loaded: settingsLoaded,
    onMap: (id) => systems?.has(id) ?? false,
  });

  if (!signedIn) return { bar: views ?? null };
  const own = ownOnMap(myCharacters, presence, main, settings.followCharacterId, problems);
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
        onOpenTracking={openTracking}
      >
        {views}
      </CharacterBar>
    ),
  };
}
