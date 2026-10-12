import type { AccessSubjectKind } from '@darkbeacon/shared';
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

export interface SubjectDescription {
  name: string;
  detail: string | null;
  imageUrl: string | null;
}

/**
 * Names of rule subjects (EVE names from ESI, account names, Discord role and server names), so
 * the rules list never shows raw ids. Composed in the server from identity's lookups; a lookup
 * that fails leaves the subject undescribed.
 */
export interface AccessSubjectDirectory {
  /** Answers keyed by `subjectKey(kind, id)`. */
  describe(
    subjects: ReadonlyArray<{ kind: AccessSubjectKind; id: string; guildId: string | null }>,
  ): Promise<Map<string, SubjectDescription>>;
}
