'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, RefreshCw, Star } from 'lucide-react';
import type { CharacterDto, CharacterPresenceDto, UniverseSystemDto } from '@darkbeacon/shared';
import { ApiError } from '../../lib/api';
import { useMapTrackingSettings, useSetTracking } from '../../lib/characters';
import { hereForReturn, relinkHref } from '../../lib/scope-health';
import { useProviders } from '../../lib/session';
import { Button, CharacterAvatar, EmptyState, IconButton, Switch, useToast } from '../../ui';
import { whereabouts } from './CharacterBar';
import styles from './characters.module.css';

/**
 * Wanderer's tracking dialog, in the map's settings (Tracking): each of my characters with a
 * clearly labelled switch for whether this map tracks it, my main on this map and the character
 * the map follows.
 */
export function TrackingPanel({
  mapId,
  myCharacters,
  accountMainId,
  characters,
  universe,
  shipName,
  canTrack,
}: {
  mapId: string;
  myCharacters: readonly CharacterDto[];
  /** The account's own main, the default main on every map. */
  accountMainId: number | null;
  characters: ReadonlyMap<number, CharacterPresenceDto>;
  universe: ReadonlyMap<number, UniverseSystemDto>;
  shipName(typeId: number): string | undefined;
  /** Members and up may track characters here. */
  canTrack: boolean;
}) {
  const toast = useToast();
  const setTracking = useSetTracking();
  const { settings, update } = useMapTrackingSettings(mapId);
  const eve = useProviders().data?.eve ?? false;
  const [pending, setPending] = useState<number | null>(null);
  const main = settings.mainCharacterId ?? accountMainId;
  const systemName = (id: number) => universe.get(id)?.name;
  const fail = (title: string) => (error: unknown) =>
    toast({
      title,
      description: error instanceof ApiError ? error.message : 'Network error',
      tone: 'danger',
    });

  const track = (character: CharacterDto, on: boolean) => {
    setPending(character.id);
    setTracking.mutate(
      { mapId, characterId: character.id, tracked: on },
      {
        onError: fail('Tracking did not change'),
        onSettled: () => setPending(null),
        // Following a character the map no longer tracks makes no sense.
        onSuccess: () => {
          if (!on && settings.followCharacterId === character.id)
            update.mutate({ followCharacterId: null }, { onError: fail('Follow did not change') });
        },
      },
    );
  };

  return (
    <div className={styles.trackPanel}>
      {myCharacters.length === 0 ? (
        <EmptyState
          compact
          title="No characters linked"
          description="Link an EVE character to your account to track it on maps."
          actions={
            eve && (
              <Button variant="primary" asChild>
                <a href={relinkHref(hereForReturn())}>Link EVE character</a>
              </Button>
            )
          }
        />
      ) : (
        <>
          {!canTrack && (
            <p className={styles.dialogNote}>
              You can view this map, but only its members may track characters on it.
            </p>
          )}
          <div className={styles.trackHead} aria-hidden>
            <span>Main</span>
            <span>Follow</span>
            <span>Track</span>
          </div>
          <ul className={styles.trackList}>
            {myCharacters.map((c) => {
              const presence = characters.get(c.id) ?? null;
              const tracked = presence !== null;
              const expired = !c.tokenValid;
              const isMain = main === c.id;
              const following = settings.followCharacterId === c.id;
              return (
                <li key={c.id} className={styles.trackRow} data-expired={expired || undefined}>
                  <CharacterAvatar id={c.id} name={c.name} size={32} />
                  <span className={styles.trackMain}>
                    <span className={styles.trackName}>{c.name}</span>
                    <span className={styles.trackWhere}>
                      {expired ? (
                        <>
                          <span className="error">Sign-in expired.</span>{' '}
                          {eve && (
                            <a
                              href={relinkHref(hereForReturn(), c.extras ?? [])}
                              className={styles.inlineLink}
                            >
                              <RefreshCw aria-hidden /> Link again
                            </a>
                          )}
                        </>
                      ) : (
                        whereabouts(presence, systemName, shipName)
                      )}
                    </span>
                  </span>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    className={styles.toggle}
                    aria-pressed={isMain}
                    label={
                      isMain ? `${c.name} is your main on this map` : `Make ${c.name} your main on this map`
                    }
                    icon={<Star />}
                    onClick={() =>
                      update.mutate(
                        // The account's own main needs no override; picking it again clears one.
                        { mainCharacterId: c.id === accountMainId ? null : c.id },
                        { onError: fail('Main did not change') },
                      )
                    }
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    className={styles.toggle}
                    aria-pressed={following}
                    disabled={!tracked}
                    label={
                      following
                        ? `Stop following ${c.name}`
                        : tracked
                          ? `Follow ${c.name}: the map moves along with its jumps`
                          : `Track ${c.name} to follow it`
                    }
                    icon={<Eye />}
                    onClick={() =>
                      update.mutate(
                        { followCharacterId: following ? null : c.id },
                        { onError: fail('Follow did not change') },
                      )
                    }
                  />
                  <Switch
                    className={styles.trackSwitch}
                    checked={tracked}
                    disabled={pending === c.id || (!tracked && (!canTrack || expired))}
                    onCheckedChange={(on) => track(c, on)}
                    label={<span className="sr-only">Track {c.name} on this map</span>}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className={styles.trackFooter}>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/characters">All maps and characters</Link>
        </Button>
      </div>
    </div>
  );
}
