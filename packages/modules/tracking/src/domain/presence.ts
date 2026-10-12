import type { CharacterPresenceDto } from '@darkbeacon/shared';

export type CharacterPresence = CharacterPresenceDto;

/** A character an account chose to track on a map. */
export interface TrackedCharacter {
  mapId: string;
  characterId: number;
  accountId: string;
  since: number;
}

/** What one ESI poll observed; fields the poll did not refresh are undefined. */
export interface Observation {
  online?: boolean;
  location?: { solarSystemId: number; docked: boolean };
  ship?: { shipTypeId: number; shipName: string };
  /** The previous location was observed recently enough that a change is one jump, not several. */
  continuous: boolean;
}

export type PresenceChange =
  | { type: 'character.online_changed'; data: { characterId: number; online: boolean } }
  | { type: 'character.moved'; data: { characterId: number; from: number | null; to: number | null } }
  | {
      type: 'character.jumped';
      data: { characterId: number; from: number; to: number; shipTypeId: number | null };
    }
  | {
      type: 'character.ship_changed';
      data: { characterId: number; shipTypeId: number; shipName: string | null };
    }
  | { type: 'character.docked_changed'; data: { characterId: number; docked: boolean } };

/**
 * Applies an observation to the stored presence and lists the resulting events.
 * A move counts as a jump only when it was observed continuously and the character did not
 * arrive docked: arriving docked means a clone jump or a pod respawn, not a trip through space.
 */
export function observe(
  presence: CharacterPresence,
  seen: Observation,
  now: number,
): { presence: CharacterPresence; changes: PresenceChange[] } {
  const next = { ...presence };
  const changes: PresenceChange[] = [];
  const characterId = presence.characterId;

  if (seen.online !== undefined && seen.online !== presence.online) {
    next.online = seen.online;
    changes.push({ type: 'character.online_changed', data: { characterId, online: seen.online } });
  }
  if (
    seen.ship &&
    (seen.ship.shipTypeId !== presence.shipTypeId || seen.ship.shipName !== presence.shipName)
  ) {
    next.shipTypeId = seen.ship.shipTypeId;
    next.shipName = seen.ship.shipName;
    changes.push({ type: 'character.ship_changed', data: { characterId, ...seen.ship } });
  }
  const from = presence.solarSystemId;
  const to = seen.location?.solarSystemId;
  if (to !== undefined && to !== from) {
    next.solarSystemId = to;
    changes.push({ type: 'character.moved', data: { characterId, from, to } });
    if (from !== null && seen.continuous && !seen.location!.docked) {
      changes.push({
        type: 'character.jumped',
        data: { characterId, from, to, shipTypeId: next.shipTypeId },
      });
    }
  }
  const docked = seen.location?.docked;
  if (docked !== undefined && docked !== presence.docked) {
    next.docked = docked;
    // Learning it for the first time is no news: it is kept with the next change.
    if (presence.docked !== undefined)
      changes.push({ type: 'character.docked_changed', data: { characterId, docked } });
  }
  if (changes.length > 0) next.updatedAt = now;
  return { presence: next, changes };
}
