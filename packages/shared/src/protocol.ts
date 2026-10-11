import { z } from 'zod';
import { DomainEventSchema } from './events.js';
import type { CharacterPresenceDto } from './dto/tracking.js';
import type { ConnectionDto, MapDto, MapSystemDto, SignatureDto } from './dto/mapping.js';

/**
 * WebSocket protocol at /ws. Commands go over REST; their results arrive here as events.
 *
 * 1. client -> {op:'subscribe', stream, sinceSeq?}
 * 2. server -> missing events as {op:'event'} (replay) or one {op:'snapshot'} when the client
 *    has no sinceSeq or the gap is too large
 * 3. server -> {op:'subscribed', stream, seq, mode}
 * 4. server -> live {op:'event'} messages; the client stores the last seq to resume.
 */
export const ClientMessage = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('subscribe'),
    stream: z.string().min(1),
    sinceSeq: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal('unsubscribe'), stream: z.string().min(1) }),
  z.object({ op: z.literal('ping') }),
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
}
