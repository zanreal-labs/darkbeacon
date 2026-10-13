/**
 * Who a ticket belongs to: an EVE character, as long as the same EVE account owns it. EVE SSO
 * says who owns a character with the `owner` hash of its token; it changes when the character is
 * sold or moved to another account. Each owner of a character gets its own support identity, so a
 * buyer never sees the seller's tickets, and a character that comes back to an earlier owner finds
 * that owner's tickets again.
 */

/** One owner of one character, as the hub remembers it. */
export interface SupportIdentityRecord {
  characterId: number;
  /** The `owner` claim of the EVE SSO token. */
  ownerHash: string;
  /** 1 for the first owner the hub saw, then 2, 3... */
  generation: number;
  characterName: string;
}

/** What a desk and the hub's pages act as. */
export interface SupportIdentity {
  /** `eve:<characterId>` for the first owner, `eve:<characterId>:o<n>` for the n-th. */
  distinctId: string;
  characterId: number;
  characterName: string;
}

/** The verified EVE SSO sign-in the identity is resolved from. */
export interface EveSignIn {
  characterId: number;
  characterName: string;
  ownerHash: string;
}

export function supportDistinctId(characterId: number, generation: number): string {
  if (!Number.isSafeInteger(characterId) || characterId <= 0) throw new Error('not a character id');
  if (!Number.isInteger(generation) || generation < 1) throw new Error('not a generation');
  return generation === 1 ? `eve:${characterId}` : `eve:${characterId}:o${generation}`;
}

/** The character id of a distinct id, or null when it is not one of ours. */
export function characterOfDistinctId(distinctId: string): number | null {
  const match = /^eve:(\d{1,19})(?::o([2-9]|[1-9]\d+))?$/.exec(distinctId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The identity a sign-in gets, given every owner the hub has seen for the character: the record of
 * the same owner when there is one, else a new generation after the highest.
 */
export function resolveIdentity(
  known: readonly SupportIdentityRecord[],
  signIn: EveSignIn,
): { record: SupportIdentityRecord; isNew: boolean } {
  const mine = known.filter((r) => r.characterId === signIn.characterId);
  const same = mine.find((r) => r.ownerHash === signIn.ownerHash);
  if (same) return { record: { ...same, characterName: signIn.characterName }, isNew: false };
  const generation = mine.reduce((max, r) => Math.max(max, r.generation), 0) + 1;
  return {
    record: {
      characterId: signIn.characterId,
      ownerHash: signIn.ownerHash,
      generation,
      characterName: signIn.characterName,
    },
    isNew: true,
  };
}

export function identityOf(record: SupportIdentityRecord): SupportIdentity {
  return {
    distinctId: supportDistinctId(record.characterId, record.generation),
    characterId: record.characterId,
    characterName: record.characterName,
  };
}
