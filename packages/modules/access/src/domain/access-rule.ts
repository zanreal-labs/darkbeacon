import type { MapRole } from '@wormwright/core';
import type { AccessSubjectKind } from '@wormwright/shared';

/** Grants `role` on a map to everyone matching the subject. */
export interface AccessRule {
  id: string;
  mapId: string;
  subjectKind: AccessSubjectKind;
  subjectId: string;
  guildId: string | null;
  role: MapRole;
  createdAt: number;
  createdBy: string;
}

/** Everything an account can be matched by. */
export interface AccessSubjects {
  accountId: string;
  characterIds: number[];
  corporationIds: number[];
  allianceIds: number[];
  discordRoles: Array<{ guildId: string; roleId: string }>;
}
