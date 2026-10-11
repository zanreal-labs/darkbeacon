import type { CharacterPresenceDto } from '@wormwright/shared';

export type CharacterPresence = CharacterPresenceDto;

/** A character an account chose to track on a map. */
export interface TrackedCharacter {
  mapId: string;
  characterId: number;
  accountId: string;
  since: number;
}
