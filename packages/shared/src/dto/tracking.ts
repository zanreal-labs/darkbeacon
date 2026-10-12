import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/** A tracked character as shown on a map. */
export const CharacterPresenceDto = z.object({
  characterId: EveId,
  accountId: Id,
  name: z.string(),
  solarSystemId: EveId.nullable(),
  shipTypeId: EveId.nullable(),
  shipName: z.string().nullable(),
  online: z.boolean(),
  updatedAt: Timestamp,
  /** Docked in a station or structure; absent when not known yet. */
  docked: z.boolean().optional(),
  /** The character's corporation and alliance (absent when not known). */
  corporationId: EveId.optional(),
  allianceId: EveId.nullable().optional(),
});
export type CharacterPresenceDto = z.infer<typeof CharacterPresenceDto>;

/** PUT /api/maps/:mapId/tracking: track or stop tracking one of your characters on a map. */
export const SetTrackingRequest = z.object({ characterId: EveId, tracked: z.boolean() });
export type SetTrackingRequest = z.infer<typeof SetTrackingRequest>;
