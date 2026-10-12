import type { Actor } from '@darkbeacon/core';
import type { AuthorDto } from '@darkbeacon/shared';

/** Who an actor is, as written on signatures, comments and structures. */
export interface AuthorDirectory {
  /** The account and its main character (or its name); null for the server's own processes. */
  author(actor: Actor): Promise<AuthorDto | null>;
}
