import { z } from 'zod';
import { AuthorDto } from './authors.js';
import { EveId, Id, Timestamp } from './common.js';

/** The longest comment, as in Wanderer. */
export const COMMENT_MAX_LENGTH = 500;

/**
 * A comment on a system of a map: a short Markdown note in a thread, newest first. Comments are
 * intel (see `ENTITY_SHARE_SCOPES`): they stay on their map unless a share includes `intel`.
 */
export const CommentDto = z.object({
  id: Id,
  mapId: Id,
  solarSystemId: EveId,
  /** Markdown. */
  text: z.string(),
  author: AuthorDto.nullable(),
  createdAt: Timestamp,
});
export type CommentDto = z.infer<typeof CommentDto>;

/** POST /api/maps/:mapId/systems/:solarSystemId/comments (member+). */
export const AddCommentRequest = z.object({ text: z.string().trim().min(1).max(COMMENT_MAX_LENGTH) });
export type AddCommentRequest = z.infer<typeof AddCommentRequest>;
