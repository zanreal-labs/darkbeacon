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
