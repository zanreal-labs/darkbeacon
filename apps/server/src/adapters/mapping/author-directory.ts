import type { AuditDirectory } from '@darkbeacon/audit';
import type { Actor } from '@darkbeacon/core';
import type { AuthorDirectory } from '@darkbeacon/mapping';
import type { AuthorDto } from '@darkbeacon/shared';

/**
 * Authors from the same directory the audit trail names people with: an account is written as its
 * main character (or its own name without one). API tokens and plugins are named by kind; the
 * server's own processes are nobody.
 */
export class DirectoryAuthors implements AuthorDirectory {
  constructor(private readonly directory: AuditDirectory) {}

  async author(actor: Actor): Promise<AuthorDto | null> {
    switch (actor.kind) {
      case 'account': {
        const account = await this.directory.account(actor.id).catch(() => null);
        return {
          accountId: actor.id,
          characterId: account?.mainCharacterId ?? null,
          name: account?.mainCharacterName ?? account?.name ?? 'Someone',
        };
      }
      case 'apiToken':
        return { accountId: null, characterId: null, name: 'API token' };
      case 'plugin':
        return { accountId: null, characterId: null, name: `Plugin ${actor.id}` };
      default:
        return null;
    }
  }
}
