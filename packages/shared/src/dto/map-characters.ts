import { z } from 'zod';
import { Timestamp } from './common.js';
import { CharacterPresenceDto } from './tracking.js';

/** One character on a map's characters page (managers): whose it is and since when it is tracked. */
export const MapTrackedCharacterDto = CharacterPresenceDto.extend({
  accountName: z.string().nullable(),
  since: Timestamp,
});
export type MapTrackedCharacterDto = z.infer<typeof MapTrackedCharacterDto>;
