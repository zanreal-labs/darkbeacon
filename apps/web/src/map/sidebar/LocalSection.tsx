'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { buildPath, routes, type CharacterDto, type CharacterPresenceDto } from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import {
  CharacterAvatar,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuTrigger,
  useToast,
} from '../../ui';
import { seedCharacters } from '../mapState';
import type { MapStore } from '../useMapStore';
import styles from './sidebar.module.css';

/**
 * Tracked characters of the map over REST, merged into the stream's: new ones only reach the
 * stream with the next snapshot, so this polls while the sidebar is open.
 */
export function usePresence(mapId: string, store: Pick<MapStore, 'seed'>) {
  const presence = useQuery({
    queryKey: ['presence', mapId],
    queryFn: () => api<CharacterPresenceDto[]>(buildPath(routes.tracking.characters.path, { mapId })),
    refetchInterval: 30_000,
  });
  const { seed } = store;
  useEffect(() => {
    if (presence.data) seed((s) => seedCharacters(s, presence.data));
  }, [presence.data, seed]);
  return presence;
}

/** Which of my characters this map tracks, switched from the section header. */
export function TrackMenu({
  mapId,
  myCharacters,
  tracked,
  onChanged,
}: {
  mapId: string;
  myCharacters: CharacterDto[];
  tracked: ReadonlySet<number>;
  onChanged(): Promise<unknown>;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<number | null>(null);
  if (myCharacters.length === 0) return null;
  const setTracking = async (characterId: number, on: boolean) => {
    setPending(characterId);
    try {
      await api(buildPath(routes.tracking.set.path, { mapId }), {
        method: 'PUT',
        json: { characterId, tracked: on },
      });
      await onChanged();
    } catch (e) {
      toast({
        title: 'Tracking did not change',
        description: e instanceof ApiError ? e.message : 'Network error',
        tone: 'danger',
      });
    } finally {
      setPending(null);
    }
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="sm" label="Track my characters" tooltipSide="left" icon={<Radio />} />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Track on this map</MenuLabel>
        {myCharacters.map((c) => (
          <MenuCheckboxItem
            key={c.id}
            checked={tracked.has(c.id)}
            disabled={!c.tokenValid || pending === c.id}
            onCheckedChange={(on) => void setTracking(c.id, on === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {c.tokenValid ? c.name : `${c.name} (sign-in expired)`}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

const shipIcon = (typeId: number) => `https://images.evetech.net/types/${typeId}/icon?size=32`;

/** Tracked characters in the selected system: portrait, name, ship; mine first and highlighted. */
export function LocalSection({ here, mine }: { here: CharacterPresenceDto[]; mine: ReadonlySet<number> }) {
  if (here.length === 0) return <p className={styles.empty}>Nobody tracked is in this system.</p>;
  const sorted = [...here].sort(
    (a, b) =>
      Number(mine.has(b.characterId)) - Number(mine.has(a.characterId)) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name),
  );
  return (
    <ul className={styles.pilots}>
      {sorted.map((c) => (
        <li
          key={c.characterId}
          className={styles.pilot}
          data-mine={mine.has(c.characterId) || undefined}
          data-online={c.online}
        >
          <CharacterAvatar id={c.characterId} name={c.name} size={24} />
          <span className={styles.pilotName}>
            {c.name}
            {mine.has(c.characterId) && <span className="sr-only"> (you)</span>}
          </span>
          <span className={styles.ship}>
            {c.shipTypeId !== null && <img src={shipIcon(c.shipTypeId)} alt="" width={16} height={16} />}
            <span>{c.online ? (c.shipName ?? 'Ship unknown') : 'Offline'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
