import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/** One end of an Ansiblex jump bridge. */
export const BridgeEndDto = z.object({
  solarSystemId: EveId,
  name: z.string(),
  security: z.number(),
  regionName: z.string(),
});
export type BridgeEndDto = z.infer<typeof BridgeEndDto>;

/**
 * An Ansiblex jump bridge a map routes over: two known-space systems linked both ways, `a` the
 * one with the lower id. `source`: pasted from the in-game structure browser or read from a
 * corporation's structures through ESI. A dangerous bridge is left out of routes that avoid
 * dangerous bridges.
 */
export const BridgeDto = z.object({
  id: Id,
  a: BridgeEndDto,
  b: BridgeEndDto,
  dangerous: z.boolean(),
  source: z.enum(['paste', 'esi']),
  /** The structure's in-game name and id, when ESI named them. */
  structureName: z.string().nullable(),
  structureId: EveId.nullable(),
  createdAt: Timestamp,
});
export type BridgeDto = z.infer<typeof BridgeDto>;

/** POST /api/maps/:mapId/bridges/paste: lines copied from the structure browser or typed. */
export const PasteBridgesRequest = z.object({
  text: z.string().max(200_000),
  /** Marks every bridge of this paste dangerous (others keep their flag). */
  dangerous: z.boolean().default(false),
});
export type PasteBridgesRequest = z.infer<typeof PasteBridgesRequest>;

export const ImportBridgesResultDto = z.object({
  added: z.number().int(),
  /** Already on the map (a paste sets their dangerous flag again). */
  known: z.number().int(),
  /** Names that are no solar system, at most a few. */
  unknownSystems: z.array(z.string()),
  /** Lines that name no pair of systems, or a pair out of range. */
  unreadable: z.array(z.object({ line: z.number().int(), text: z.string(), reason: z.string() })),
  bridges: z.array(BridgeDto),
});
export type ImportBridgesResultDto = z.infer<typeof ImportBridgesResultDto>;

/** POST /api/maps/:mapId/bridges/esi: reads the Ansiblex gates of a character's corporation. */
export const ReadBridgesFromEsiRequest = z.object({ characterId: EveId });
export type ReadBridgesFromEsiRequest = z.infer<typeof ReadBridgesFromEsiRequest>;

/** PATCH /api/maps/:mapId/bridges/:bridgeId */
export const UpdateBridgeRequest = z.object({ dangerous: z.boolean() });
export type UpdateBridgeRequest = z.infer<typeof UpdateBridgeRequest>;
