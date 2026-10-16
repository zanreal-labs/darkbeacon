'use client';

import { useState, type ReactNode } from 'react';
import { Eye, Star, TriangleAlert, UsersRound } from 'lucide-react';
import type {
  CharacterDto,
  CharacterPresenceDto,
  TrackingProblemDto,
  UniverseSystemDto,
} from '@darkbeacon/shared';
import { cx, CharacterAvatar, Popover, PopoverContent, PopoverTrigger, Tooltip } from '../../ui';
import { ActivityDialog } from './ActivityDialog';
import { OnTheMapPanel } from './OnTheMapPanel';
import styles from './characters.module.css';

/** How many of my characters the strip shows before it says "+n". */
const SHOWN = 5;

export interface OwnCharacter {
  character: CharacterDto;
  presence: CharacterPresenceDto | null;
  main: boolean;
  following: boolean;
  /** Why tracking cannot read where it is, while it cannot. */
  problem?: TrackingProblemDto;
}

/** My characters tracked on this map, main first, then online ones, then by name. */
export function ownOnMap(
  myCharacters: readonly CharacterDto[],
  characters: ReadonlyMap<number, CharacterPresenceDto>,
  mainId: number | null,
  followId: number | null,
  problems: ReadonlyMap<number, TrackingProblemDto> = new Map(),
): OwnCharacter[] {
  return myCharacters
    .filter((c) => characters.has(c.id))
    .map((c) => ({
      character: c,
      presence: characters.get(c.id) ?? null,
      main: c.id === mainId,
      following: c.id === followId,
      ...(problems.has(c.id) ? { problem: problems.get(c.id)! } : {}),
    }))
    .sort(
      (a, b) =>
        Number(b.main) - Number(a.main) ||
        Number(!!b.presence?.online) - Number(!!a.presence?.online) ||
        a.character.name.localeCompare(b.character.name),
    );
}

/** One line about where a character is: system, ship, docked, or why nothing is known. */
export function whereabouts(
  presence: CharacterPresenceDto | null,
  systemName: (id: number) => string | undefined,
  shipName: (typeId: number) => string | undefined,
): string {
  if (!presence) return 'Not tracked on this map';
  if (!presence.online) return 'Offline';
  const system =
    presence.solarSystemId !== null ? (systemName(presence.solarSystemId) ?? 'Unknown system') : null;
  const ship = presence.shipTypeId !== null ? (shipName(presence.shipTypeId) ?? null) : null;
  return [system ?? 'Location unknown', ship, presence.docked ? 'docked' : null].filter(Boolean).join(' · ');
}

/**
 * The map's character controls in its top bar: my characters tracked here (portraits with
 * online, expired, main and followed marks; a click centres the map on one), a mark only while
 * tracking needs a look (a sign-in expired, or tracking cannot read where a character is; it
 * opens Tracking in the map's settings), the quick views (`children`, where the tracking button
 * was) and "On the map" with everyone tracked here.
 */
export function CharacterBar({
  mapId,
  own,
  hasCharacters,
  characters,
  universe,
  shipName,
  canSeeAll,
  onCenter,
  onOpenTracking,
  children,
}: {
  mapId: string;
  own: OwnCharacter[];
  /** I have linked characters at all (else the tracking button is pointless). */
  hasCharacters: boolean;
  characters: ReadonlyMap<number, CharacterPresenceDto>;
  universe: ReadonlyMap<number, UniverseSystemDto>;
  shipName(typeId: number): string | undefined;
  /** Members and up see who is on the map (as in Wanderer). */
  canSeeAll: boolean;
  onCenter(solarSystemId: number): void;
  /** Tracking in the map's settings. */
  onOpenTracking(): void;
  /** The quick views, between my characters and On the map. */
  children?: ReactNode;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [activity, setActivity] = useState(false);
  const shown = own.slice(0, SHOWN);
  const expired = own.filter((o) => !o.character.tokenValid).length;
  // An expired sign-in says so itself; the others are characters tracking cannot read.
  const unread = own.filter((o) => o.character.tokenValid && o.problem);
  const attention = [
    expired > 0 ? `${expired} sign-in${expired === 1 ? '' : 's'} expired` : null,
    unread.length > 0
      ? `cannot read where ${unread.map((o) => o.character.name).join(', ')} ${unread.length === 1 ? 'is' : 'are'}`
      : null,
  ]
    .filter(Boolean)
    .join('; ');
  const online = [...characters.values()].filter((c) => c.online).length;
  const systemName = (id: number) => universe.get(id)?.name;
  return (
    <div className={styles.bar}>
      {hasCharacters && own.length > 0 && (
        <div className={styles.group} role="group" aria-label="My characters on this map">
          {shown.map((o) => {
            const where = whereabouts(o.presence, systemName, shipName);
            const expired = !o.character.tokenValid;
            const at = o.presence?.online ? o.presence.solarSystemId : null;
            const tip = [
              o.character.name,
              expired
                ? 'Sign-in expired: link it again to resume tracking'
                : o.problem
                  ? `${where} · ${o.problem.message}`
                  : where,
              o.main ? 'Main on this map' : null,
              o.following ? 'The map follows it' : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Tooltip key={o.character.id} content={tip}>
                <button
                  type="button"
                  className={styles.portrait}
                  data-online={(!!o.presence?.online && !expired) || undefined}
                  data-expired={expired || undefined}
                  data-problem={(!expired && !!o.problem) || undefined}
                  aria-label={tip}
                  disabled={at === null}
                  onClick={() => at !== null && onCenter(at)}
                >
                  <CharacterAvatar id={o.character.id} name={o.character.name} size={24} />
                  {o.main && <Star className={cx(styles.mark, styles.mainMark)} aria-hidden />}
                  {o.following && <Eye className={cx(styles.mark, styles.followMark)} aria-hidden />}
                </button>
              </Tooltip>
            );
          })}
          {own.length > SHOWN && <span className={styles.more}>+{own.length - SHOWN}</span>}
          {attention && (
            <Tooltip content={`Tracking needs a look: ${attention}`}>
              <button
                type="button"
                className={styles.attention}
                onClick={onOpenTracking}
                aria-label={`Tracking needs a look: ${attention}`}
              >
                <TriangleAlert aria-hidden />
              </button>
            </Tooltip>
          )}
        </div>
      )}
      {children}
      {canSeeAll && (
        <Popover open={listOpen} onOpenChange={setListOpen}>
          <Tooltip content="Everyone tracked on this map">
            <PopoverTrigger className={styles.onMapButton} aria-label={`On the map: ${online} online`}>
              <UsersRound aria-hidden />
              <span>{online}</span>
            </PopoverTrigger>
          </Tooltip>
          {/* Opening it leaves focus on the button: no keyboard popping up on phones. */}
          <PopoverContent align="end" width={360} onOpenAutoFocus={(e) => e.preventDefault()}>
            <OnTheMapPanel
              characters={characters}
              universe={universe}
              shipName={shipName}
              onCenter={onCenter}
              onShowActivity={() => {
                setListOpen(false);
                setActivity(true);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <ActivityDialog mapId={mapId} open={activity} onOpenChange={setActivity} />
    </div>
  );
}
