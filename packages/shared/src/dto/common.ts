import { z } from 'zod';

/** Epoch milliseconds. */
export const Timestamp = z.number().int().nonnegative();
export const Id = z.string().min(1);
/** EVE entity ids (characters, corporations, systems...). */
export const EveId = z.number().int().positive();

export const ApiErrorCode = z.enum([
  'not_found',
  'forbidden',
  'unauthenticated',
  'conflict',
  'validation',
  'bad_request',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Body of every non-2xx JSON response. */
export const ApiErrorBody = z.object({
  error: z.object({ code: ApiErrorCode, message: z.string(), details: z.unknown().optional() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const HealthDto = z.object({
  status: z.literal('ok'),
  version: z.string(),
  database: z.enum(['sqlite', 'postgres']),
});
export type HealthDto = z.infer<typeof HealthDto>;

/**
 * The state of a realtime stream at `seq`, read over REST so a server-rendered page can show it
 * before its WebSocket opens; the client then subscribes with `sinceSeq: seq` and only gets
 * what happened after. `data` has the same shape as the WebSocket snapshot (e.g. `MapSnapshot`).
 */
export const StreamSnapshotDto = z.object({
  stream: z.string(),
  seq: z.number().int().min(0),
  data: z.record(z.string(), z.unknown()),
});
export type StreamSnapshotDto = z.infer<typeof StreamSnapshotDto>;
