/** A contact's standing as ESI lists it (-10 to +10). */
export interface Contact {
  id: number;
  standing: number;
}

/** One character's contact lists; any may be missing (no scope, no alliance, ESI unavailable). */
export interface CharacterContacts {
  characterId: number;
  corporationId: number;
  allianceId: number | null;
  character: readonly Contact[] | null;
  corporation: readonly Contact[] | null;
  alliance: readonly Contact[] | null;
}

/** Standing of one's own alliance and corporation: as blue as it gets. */
export const OWN_STANDING = 10;

/**
 * An account's standings towards everyone its characters know: per character the alliance's
 * contacts win over the corporation's, which win over the character's own (as the game shows
 * them); between characters the earlier one (the main first) wins. Every character's own alliance
 * and corporation are +10.
 */
export function mergeStandings(characters: readonly CharacterContacts[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const c of characters) {
    const mine = new Map<number, number>();
    for (const list of [c.character, c.corporation, c.alliance]) {
      for (const contact of list ?? []) mine.set(contact.id, contact.standing);
    }
    for (const [id, standing] of mine) if (!result.has(id)) result.set(id, standing);
  }
  for (const c of characters) {
    result.set(c.corporationId, OWN_STANDING);
    if (c.allianceId !== null) result.set(c.allianceId, OWN_STANDING);
  }
  return result;
}
