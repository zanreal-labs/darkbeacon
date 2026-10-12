import { z } from 'zod';
import { EveId, Id } from './common.js';

/**
 * Who wrote something on a map (a signature, a comment, a structure): the account's main
 * character when it has one, as it was named then. Null for changes made by the server itself.
 */
export const AuthorDto = z.object({
  /** The account behind it; null for API tokens and plugins. */
  accountId: Id.nullable(),
  /** Its main character at the time, for the portrait; null when it had none. */
  characterId: EveId.nullable(),
  name: z.string(),
});
export type AuthorDto = z.infer<typeof AuthorDto>;
