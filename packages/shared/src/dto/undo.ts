import { z } from 'zod';
import { AuditEntryDto } from './audit.js';
import { Id } from './common.js';

/**
 * The header a client names one gesture with (a random id per gesture: a drag, a delete of a
 * selection, a paste). Every change the gesture makes is recorded with it, and
 * `POST /api/maps/:mapId/history/undo` undoes them together.
 */
export const ACTION_HEADER = 'x-darkbeacon-action';

/** Letters, digits, `-` and `_`, 8 to 64 of them. */
export const ActionId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export type ActionId = z.infer<typeof ActionId>;

export const UndoActionRequest = z.object({ action: ActionId });
export type UndoActionRequest = z.infer<typeof UndoActionRequest>;

/** A change of the gesture that could not be undone, and why (it changed again since, ...). */
export const UndoFailureDto = z.object({ eventId: Id, type: z.string(), reason: z.string() });
export type UndoFailureDto = z.infer<typeof UndoFailureDto>;

/**
 * Result of undoing a gesture: the changes put back (newest first as they were undone), what the
 * undo wrote, and the changes that stayed. 409 when nothing could be undone.
 */
export const UndoResultDto = z.object({
  action: ActionId,
  reverted: z.array(Id),
  entries: z.array(AuditEntryDto),
  failed: z.array(UndoFailureDto),
});
export type UndoResultDto = z.infer<typeof UndoResultDto>;
