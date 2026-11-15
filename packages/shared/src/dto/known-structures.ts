import { z } from 'zod';
import { EveId } from './common.js';

/**
 * Where a known structure comes from: `npc` an NPC station (SDE), `public` an Upwell structure
 * anyone may dock at (ESI `GET /universe/structures`), `access` one the viewer's characters are on
 * the access list of (their structure search), which only that account sees.
 */
export const KnownStructureSource = z.enum(['npc', 'public', 'access']);
export type KnownStructureSource = z.infer<typeof KnownStructureSource>;

/** A station or Upwell structure in a system, as EVE says (not the map's own structure notes). */
export const KnownStructureDto = z.object({
  id: EveId,
  name: z.string(),
  solarSystemId: EveId,
  /** The structure's type (Astrahus, Raitaru...); null for NPC stations and when ESI leaves it out. */
  typeId: EveId.nullable(),
  typeName: z.string().nullable(),
  /** The owning corporation; null for NPC stations. */
  owner: z
    .object({ id: EveId, name: z.string().nullable(), ticker: z.string().nullable() })
    .nullable(),
  source: KnownStructureSource,
});
export type KnownStructureDto = z.infer<typeof KnownStructureDto>;

/** GET /api/universe/structures?systems=1,2,3 */
export const KnownStructuresQuery = z.object({
  systems: z
    .string()
    .transform((s) => s.split(',').filter(Boolean).map(Number))
    .pipe(z.array(EveId).min(1).max(25)),
});
export type KnownStructuresQuery = z.infer<typeof KnownStructuresQuery>;

export const KnownStructuresDto = z.object({
  /** Every known station and structure of the asked systems, stations first, then by name. */
  structures: z.array(KnownStructureDto),
  /**
   * Why structures the viewer's characters may use are missing: `scope` none of them granted the
   * structure search and structure reads, `unavailable` EVE did not answer; null when they are in.
   */
  access: z.enum(['scope', 'unavailable']).nullable(),
});
export type KnownStructuresDto = z.infer<typeof KnownStructuresDto>;
