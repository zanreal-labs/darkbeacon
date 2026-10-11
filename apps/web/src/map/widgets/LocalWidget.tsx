import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type CharacterDto,
  type CharacterPresenceDto,
  type UniverseSystemDto,
} from '@wormwright/shared';
import { api, ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { seedCharacters } from '../mapState';
import type { MapStore } from '../useMapStore';
import styles from './widgets.module.css';

interface Props {
  mapId: string;
  selected: number | null;
  characters: CharacterPresenceDto[];
  universe: Map<number, UniverseSystemDto>;
  myCharacters: CharacterDto[];
  can: MapPermissions;
  store: Pick<MapStore, 'seed'>;
}

/** Tracked characters: who is in the selected system, everyone else below, and your tracking switches. */
export function LocalWidget({ mapId, selected, characters, universe, myCharacters, can, store }: Props) {
  const [error, setError] = useState<string | null>(null);
  const presence = useQuery({
    queryKey: ['presence', mapId],
    queryFn: () => api<CharacterPresenceDto[]>(buildPath(routes.tracking.characters.path, { mapId })),
    // New tracked characters only reach the stream with the next snapshot; poll for them.
    refetchInterval: 30_000,
  });
  const { seed } = store;
  useEffect(() => {
    if (presence.data) seed((s) => seedCharacters(s, presence.data));
  }, [presence.data, seed]);

  const here = characters.filter((c) => selected !== null && c.solarSystemId === selected);
  const elsewhere = characters.filter((c) => !here.includes(c));
  const tracked = new Set(characters.map((c) => c.characterId));

  const setTracking = async (characterId: number, on: boolean) => {
    setError(null);
    try {
      await api(buildPath(routes.tracking.set.path, { mapId }), {
        method: 'PUT',
        json: { characterId, tracked: on },
      });
      await presence.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change tracking');
    }
  };

  const row = (c: CharacterPresenceDto) => (
    <li key={c.characterId} className={styles.character} data-online={c.online}>
      <span className={styles.onlineDot} title={c.online ? 'Online' : 'Offline'} />
      <span className={styles.ellipsis}>{c.name}</span>
      <span className="muted">{c.shipName ?? ''}</span>
      {selected !== c.solarSystemId && c.solarSystemId !== null && (
        <span className="muted">{universe.get(c.solarSystemId)?.name ?? c.solarSystemId}</span>
      )}
    </li>
  );

  return (
    <div className={styles.widget}>
      <h4 className={styles.subhead}>In this system</h4>
      {selected === null ? (
        <p className="muted">Select a system.</p>
      ) : here.length === 0 ? (
        <p className="muted">Nobody tracked here.</p>
      ) : (
        <ul className={styles.list}>{here.map(row)}</ul>
      )}

      {elsewhere.length > 0 && (
        <>
          <h4 className={styles.subhead}>Elsewhere</h4>
          <ul className={styles.list}>{elsewhere.map(row)}</ul>
        </>
      )}

      {can.edit && myCharacters.length > 0 && (
        <>
          <h4 className={styles.subhead}>Track my characters</h4>
          <ul className={styles.list}>
            {myCharacters.map((c) => (
              <li key={c.id}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={tracked.has(c.id)}
                    disabled={!c.tokenValid}
                    onChange={(e) => void setTracking(c.id, e.target.checked)}
                  />
                  {c.name}
                  {!c.tokenValid && <span className="error"> (re-link needed)</span>}
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
