'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Rocket, UsersRound } from 'lucide-react';
import {
  buildPath,
  routes,
  type CharacterDto,
  type CharacterPresenceDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { Callout, CharacterAvatar, EmptyState, Switch } from '../../ui';
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
  const [pending, setPending] = useState<number | null>(null);
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
    setPending(characterId);
    try {
      await api(buildPath(routes.tracking.set.path, { mapId }), {
        method: 'PUT',
        json: { characterId, tracked: on },
      });
      await presence.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change tracking');
    } finally {
      setPending(null);
    }
  };

  const row = (c: CharacterPresenceDto) => {
    const where =
      c.solarSystemId !== null ? (universe.get(c.solarSystemId)?.name ?? String(c.solarSystemId)) : null;
    return (
      <li key={c.characterId} className={styles.pilot} data-online={c.online}>
        <span className={styles.pilotAvatar}>
          <CharacterAvatar id={c.characterId} name={c.name} size={28} />
          <span className={styles.onlineDot} title={c.online ? 'Online' : 'Offline'} />
        </span>
        <span className={styles.pilotMain}>
          <span className={styles.pilotName}>{c.name}</span>
          <span className={styles.pilotMeta}>{c.shipName ?? (c.online ? 'Ship unknown' : 'Offline')}</span>
        </span>
        {where && selected !== c.solarSystemId && (
          <span className={`${styles.pilotWhere} mono`}>{where}</span>
        )}
      </li>
    );
  };

  return (
    <div className={styles.widget}>
      {characters.length > 0 && (
        <section className={styles.section} aria-label="In this system">
          <h3 className={styles.sectionTitle}>
            In this system
            {here.length > 0 && <span className={styles.sectionCount}>{here.length}</span>}
          </h3>
          {selected === null ? (
            <p className={styles.quiet}>Select a system to see who is there.</p>
          ) : here.length === 0 ? (
            <p className={styles.quiet}>Nobody tracked is here.</p>
          ) : (
            <ul className={styles.pilots}>{here.map(row)}</ul>
          )}
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className={styles.section} aria-label="Elsewhere">
          <h3 className={styles.sectionTitle}>
            Elsewhere
            <span className={styles.sectionCount}>{elsewhere.length}</span>
          </h3>
          <ul className={styles.pilots}>{elsewhere.map(row)}</ul>
        </section>
      )}

      {characters.length === 0 && (
        <EmptyState
          compact
          icon={<UsersRound />}
          title="Nobody is tracked"
          description="Track your characters below and the map follows them as they jump."
        />
      )}

      {can.edit && myCharacters.length > 0 && (
        <section className={styles.section} aria-label="Track my characters">
          <h3 className={styles.sectionTitle}>Track my characters</h3>
          <ul className={styles.trackList}>
            {myCharacters.map((c) => (
              <li key={c.id} className={styles.trackRow}>
                <CharacterAvatar id={c.id} name={c.name} size={28} />
                <span className={styles.pilotMain}>
                  <span className={styles.pilotName}>{c.name}</span>
                  <span className={styles.pilotMeta} data-tone={c.tokenValid ? undefined : 'danger'}>
                    {!c.tokenValid
                      ? 'Sign-in expired: link it again on your account page'
                      : tracked.has(c.id)
                        ? 'Tracked on this map'
                        : 'Not tracked'}
                  </span>
                </span>
                <Switch
                  checked={tracked.has(c.id)}
                  disabled={!c.tokenValid || pending === c.id}
                  onCheckedChange={(on) => void setTracking(c.id, on)}
                  label={<span className="sr-only">Track {c.name}</span>}
                />
              </li>
            ))}
          </ul>
          {error && (
            <Callout tone="danger" title="Tracking did not change">
              {error}
            </Callout>
          )}
        </section>
      )}

      {can.edit && myCharacters.length === 0 && (
        <section className={styles.section}>
          <Callout tone="neutral" icon={<Rocket />} title="Link a character to track it">
            Add your EVE characters on the account page, then switch tracking on here.
          </Callout>
        </section>
      )}
    </div>
  );
}
