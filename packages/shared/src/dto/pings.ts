import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/** Kinds of ping; Wanderer has rally points (its "alert" pings were never used). */
export const PingType = z.enum(['rally']);
export type PingType = z.infer<typeof PingType>;

export const PING_MESSAGE_MAX = 500;

/**
 * A rally ping: one system of a map everyone is called to. One per map; a new one replaces it.
 * The system cannot be removed while it is pinged. The `ping.created` event carries this.
 */
export const MapPingDto = z.object({
  id: Id,
  mapId: Id,
  solarSystemId: EveId,
  type: PingType,
  message: z.string(),
  /** The account that called it. */
  createdBy: z.string(),
  createdByName: z.string().nullable(),
  /** The character it was called with (the account's main character then). */
  characterId: EveId.nullable(),
  characterName: z.string().nullable(),
  createdAt: Timestamp,
});
export type MapPingDto = z.infer<typeof MapPingDto>;

export const CreatePingRequest = z.object({
  solarSystemId: EveId,
  type: PingType.default('rally'),
  message: z.string().trim().max(PING_MESSAGE_MAX).default(''),
});
export type CreatePingRequest = z.infer<typeof CreatePingRequest>;
export type CreatePingInput = z.input<typeof CreatePingRequest>;
