import { z } from 'zod';
import { DomainEventSchema } from './events.js';
import type { CharacterPresenceDto } from './dto/tracking.js';
import { PresencePeerDto, PresenceStatePatch } from './dto/presence.js';
import type { ConnectionDto, MapDto, MapSystemDto, SignatureDto } from './dto/mapping.js';
import type { MapExitDto } from './dto/routing.js';
import type { MapSourceDto } from './dto/sharing.js';

/**
 * WebSocket protocol at /ws. Commands go over REST; their results arrive here as events.
 *
 * 1. client -> {op:'subscribe', stream, sinceSeq?}
 * 2. server -> missing events as {op:'event'} (replay) or one {op:'snapshot'} when the client
 *    has no sinceSeq or the gap is too large
 * 3. server -> {op:'subscribed', stream, seq, mode}
 * 4. server -> live {op:'event'} messages; the client stores the last seq to resume.
 *
 * Presence (ephemeral, never stored, separate from events) on a `map:<id>` stream the socket
 * follows: the client sends {op:'presence', stream, state} (a patch; the first one joins) and
 * {op:'presence.leave', stream}; the server answers the joiner with the full list of the others
 * ({op:'presence', full: true}) and then sends changes, coalesced per map at most PRESENCE_HZ
 * times a second ({op:'presence', full: false, peers: changed, left: keys}). Unsubscribing,
 * losing access or closing the socket leaves.
 */
export const ClientMessage = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('subscribe'),
    stream: z.string().min(1),
    sinceSeq: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal('unsubscribe'), stream: z.string().min(1) }),
  z.object({ op: z.literal('ping') }),
  z.object({ op: z.literal('presence'), stream: z.string().min(1), state: PresenceStatePatch }),
  z.object({ op: z.literal('presence.leave'), stream: z.string().min(1) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const WsErrorCode = z.enum([
  'bad_request',
  'unauthenticated',
  'forbidden',
  'unknown_stream',
  'internal',
]);
export type WsErrorCode = z.infer<typeof WsErrorCode>;

export const ServerMessage = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('snapshot'),
    stream: z.string(),
    seq: z.number().int().min(0),
    data: z.unknown(),
  }),
  z.object({
    op: z.literal('subscribed'),
    stream: z.string(),
    seq: z.number().int().min(0),
    mode: z.enum(['replay', 'snapshot']),
  }),
  z.object({ op: z.literal('event'), event: DomainEventSchema }),
  z.object({ op: z.literal('unsubscribed'), stream: z.string() }),
  z.object({ op: z.literal('error'), stream: z.string().optional(), code: WsErrorCode, message: z.string() }),
  z.object({ op: z.literal('pong') }),
  z.object({
    op: z.literal('presence'),
    stream: z.string(),
    /** True: `peers` is everyone else on the map (replace); false: only those who changed. */
    full: z.boolean(),
    peers: z.array(PresencePeerDto),
    /** Keys of peers who left. */
    left: z.array(z.string()),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/**
 * `data` of a snapshot on a `map:<id>` stream. Several modules contribute parts, so every
 * part is optional; a missing part means "this server has no such module", not "empty".
 */
export interface MapSnapshot {
  map?: MapDto;
  systems?: MapSystemDto[];
  connections?: ConnectionDto[];
  signatures?: SignatureDto[];
  characters?: CharacterPresenceDto[];
  /** Ways out of the chain (shortest mode, trade and map hubs); see `routes.exits_changed`. */
  exits?: MapExitDto[];
  /**
   * Present on maps that merge other maps (composites, and maps with accepted shares): the maps
   * merged in. Their systems, connections and signatures are then the merged ones, each with a
   * `provenance`, and the map's own (unmerged) entity events are to be ignored.
   */
  sources?: MapSourceDto[];
}
