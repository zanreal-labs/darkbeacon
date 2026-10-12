import { z } from 'zod';
import { EveId } from './common.js';
import { WormholeEffect } from './wormholes.js';

/**
 * A solar system from static game data. `whClass` is the SDE wormhole class id:
 * 1-6 = C1-C6, 7 = high-sec, 8 = low-sec, 9 = null-sec, 12 = Thera, 13 = shattered frigate holes,
 * 14-18 = Drifter systems, 25 = Pochven; null when unknown. `statics` and `effect` come from the
 * wormhole dataset next to the SDE data (`@darkbeacon/sde`).
 */
export const UniverseSystemDto = z.object({
  id: EveId,
  name: z.string(),
  regionName: z.string(),
  constellationName: z.string(),
  security: z.number(),
  whClass: z.number().int().nullable(),
  /** Static wormhole types of a wormhole system (e.g. `D845`); empty when none or not known. */
  statics: z.array(z.string()),
  /** The system's wormhole effect; null when it has none or it is not known. */
  effect: WormholeEffect.nullable(),
});
export type UniverseSystemDto = z.infer<typeof UniverseSystemDto>;

/** GET /api/universe/systems?q= */
export const UniverseSearchQuery = z.object({
  q: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type UniverseSearchQuery = z.infer<typeof UniverseSearchQuery>;
