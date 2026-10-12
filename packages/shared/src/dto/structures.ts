import { z } from 'zod';
import { AuthorDto } from './authors.js';
import { EveId, Id, Timestamp } from './common.js';

/**
 * Upwell structures that can be pasted from d-scan or the overview: type id -> name, as the game
 * names them. Others can still be added by hand with any type.
 */
export const STRUCTURE_TYPES: Readonly<Record<number, string>> = {
  35825: 'Raitaru',
  35826: 'Azbel',
  35827: 'Sotiyo',
  35832: 'Astrahus',
  35833: 'Fortizar',
  35834: 'Keepstar',
  35835: 'Athanor',
  35836: 'Tatara',
  40340: 'Upwell Palatine Keepstar',
  47512: "'Moreau' Fortizar",
  47513: "'Draccous' Fortizar",
  47514: "'Horizon' Fortizar",
  47515: "'Marginis' Fortizar",
  47516: "'Prometheus' Fortizar",
};

export const StructureStatus = z.enum([
  'powered',
  'anchoring',
  'unanchoring',
  'lowPower',
  'abandoned',
  'reinforced',
]);
export type StructureStatus = z.infer<typeof StructureStatus>;

export const STRUCTURE_STATUS_LABEL: Record<StructureStatus, string> = {
  powered: 'Powered',
  anchoring: 'Anchoring',
  unanchoring: 'Unanchoring',
  lowPower: 'Low Power',
  abandoned: 'Abandoned',
  reinforced: 'Reinforced',
};

/** Statuses that run against a timer (`endsAt`); the others have none. */
export const TIMED_STRUCTURE_STATUSES: readonly StructureStatus[] = ['anchoring', 'reinforced'];

/** The corporation that owns a structure. */
export const StructureOwnerDto = z.object({
  id: EveId.nullable(),
  name: z.string().max(100),
  ticker: z.string().max(10).nullable(),
});
export type StructureOwnerDto = z.infer<typeof StructureOwnerDto>;

/**
 * A structure in a system of a map, with its owner and timer. Structures are intel (see
 * `ENTITY_SHARE_SCOPES`): they stay on their map unless a share includes `intel`.
 */
export const StructureDto = z.object({
  id: Id,
  mapId: Id,
  solarSystemId: EveId,
  /** EVE type id, null when added by hand without one. */
  typeId: EveId.nullable(),
  typeName: z.string(),
  name: z.string(),
  owner: StructureOwnerDto.nullable(),
  status: StructureStatus,
  /** When the timer of an anchoring or reinforced structure runs out (EVE time is UTC). */
  endsAt: Timestamp.nullable(),
  notes: z.string(),
  createdBy: AuthorDto.nullable(),
  updatedBy: AuthorDto.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type StructureDto = z.infer<typeof StructureDto>;

const editable = {
  name: z.string().trim().min(1).max(100),
  owner: StructureOwnerDto.nullable(),
  status: StructureStatus,
  endsAt: Timestamp.nullable(),
  notes: z.string().max(2000),
};

/** POST /api/maps/:mapId/systems/:solarSystemId/structures (member+). */
export const AddStructureRequest = z.object({
  typeId: EveId.nullable().optional(),
  typeName: z.string().trim().min(1).max(100),
  ...editable,
  owner: editable.owner.optional(),
  status: editable.status.optional(),
  endsAt: editable.endsAt.optional(),
  notes: editable.notes.optional(),
});
export type AddStructureRequest = z.infer<typeof AddStructureRequest>;

/** PATCH /api/maps/:mapId/structures/:structureId (member+). A status without a timer clears `endsAt`. */
export const UpdateStructureRequest = z.object(editable).partial();
export type UpdateStructureRequest = z.infer<typeof UpdateStructureRequest>;

/**
 * POST /api/maps/:mapId/systems/:solarSystemId/structures/paste (member+): d-scan lines (one
 * structure each: type id, name, type, distance) add structures; the three lines of a timer
 * ("J123456 - Name", distance, "Reinforced until 2025.01.13 23:51") set the status and timer of
 * the structure of that name.
 */
export const PasteStructuresRequest = z.object({ text: z.string().max(50_000) });
export type PasteStructuresRequest = z.infer<typeof PasteStructuresRequest>;

export const PasteStructuresResult = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  /** Lines that were not understood, or a timer for a structure that is not listed. */
  skipped: z.array(z.string()),
});
export type PasteStructuresResult = z.infer<typeof PasteStructuresResult>;

/** PUT /api/maps/:mapId/systems/:solarSystemId/structures/owner (member+): one owner for all of them. */
export const SetStructureOwnersRequest = z.object({ owner: StructureOwnerDto.nullable() });
export type SetStructureOwnersRequest = z.infer<typeof SetStructureOwnersRequest>;
