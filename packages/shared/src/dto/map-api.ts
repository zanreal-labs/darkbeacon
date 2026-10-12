import { z } from 'zod';
import { EveId, Id } from './common.js';
import { ConnectionDto, MapSystemDto, UpdateConnectionRequest, UpdateSystemRequest } from './mapping.js';
import { DomainEventSchema } from '../events.js';

/**
 * POST /api/maps/:mapId/batch: systems and connections added or changed in one transaction (all
 * or nothing). A system is added (or a hidden one restored) when it is not on the map, then given
 * the fields; a connection is found by its two systems in either direction, else added.
 */
export const BatchUpsertRequest = z
  .object({
    systems: z
      .array(UpdateSystemRequest.omit({ visible: true }).extend({ solarSystemId: EveId }))
      .max(500)
      .default([]),
    connections: z
      .array(UpdateConnectionRequest.extend({ source: EveId, target: EveId }))
      .max(1000)
      .default([]),
  })
  .refine((r) => r.systems.length + r.connections.length > 0, { message: 'Nothing to change' });
export type BatchUpsertRequest = z.infer<typeof BatchUpsertRequest>;

export const BatchUpsertResultDto = z.object({
  systems: z.array(MapSystemDto),
  connections: z.array(ConnectionDto),
});
export type BatchUpsertResultDto = z.infer<typeof BatchUpsertResultDto>;

/** A connection named by its id or by its two systems (either direction). */
export const ConnectionRef = z.union([Id, z.object({ source: EveId, target: EveId })]);
export type ConnectionRef = z.infer<typeof ConnectionRef>;

/**
 * POST /api/maps/:mapId/batch/delete: connections removed and systems taken off the map (hidden,
 * keeping their intel) in one transaction. Missing ones are skipped and counted.
 */
export const BatchDeleteRequest = z
  .object({
    systems: z.array(EveId).max(500).default([]),
    connections: z.array(ConnectionRef).max(1000).default([]),
  })
  .refine((r) => r.systems.length + r.connections.length > 0, { message: 'Nothing to delete' });
export type BatchDeleteRequest = z.infer<typeof BatchDeleteRequest>;

export const BatchDeleteResultDto = z.object({
  systems: z.number().int(),
  connections: z.number().int(),
  /** Named but not on the map (or not visible). */
  missing: z.number().int(),
});
export type BatchDeleteResultDto = z.infer<typeof BatchDeleteResultDto>;

/** `:source/:target` of the connection-by-pair routes. */
export const SystemPairParams = z.object({
  source: z.coerce.number().pipe(EveId),
  target: z.coerce.number().pipe(EveId),
});

/**
 * GET /api/maps/:mapId/events: the map's events after `sinceSeq`, oldest first, from the durable
 * log (the same events the WebSocket and webhooks carry). `types` filters by type, `*` ending a
 * prefix (`system.*`); filtered events still move `nextSeq`.
 */
export const EventsQuery = z.object({
  sinceSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  types: z
    .string()
    .max(1000)
    .optional()
    .transform((v) =>
      v
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
});
export type EventsQuery = z.infer<typeof EventsQuery>;

export const EventsPageDto = z.object({
  events: z.array(DomainEventSchema),
  /** Pass as `sinceSeq` for the next page. */
  nextSeq: z.number().int(),
  /** The newest seq of the map right now. */
  headSeq: z.number().int(),
  /** More events wait after `nextSeq`. */
  more: z.boolean(),
  /**
   * Events after `sinceSeq` were pruned from the log (retention): what is missing must be read
   * again (the snapshot at `/api/streams/map:<id>/snapshot`) before following on.
   */
  gap: z.boolean(),
});
export type EventsPageDto = z.infer<typeof EventsPageDto>;

/**
 * GET /api/streams/:stream/sse: Server-Sent Events of a stream. Resumes after `sinceSeq` (or the
 * `Last-Event-ID` header); without either it starts at the newest event, or with a snapshot
 * first when `snapshot=true`.
 */
export const SseQuery = z.object({
  sinceSeq: z.coerce.number().int().min(0).optional(),
  snapshot: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  types: EventsQuery.shape.types,
});
export type SseQuery = z.infer<typeof SseQuery>;
