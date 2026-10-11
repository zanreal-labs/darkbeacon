import type { AccessSubjects } from '../domain/access-rule.js';

/** Provided by identity: characters, corporations, alliances and Discord roles of an account. */
export interface AccessSubjectsSource {
  subjectsOf(accountId: string): Promise<AccessSubjects>;
}

/** Provided by mapping: who owns a map (the owner is always map admin). */
export interface MapOwnership {
  ownerOf(mapId: string): Promise<string | null>;
  mapsOwnedBy(accountId: string): Promise<string[]>;
}
