import { Inject, Injectable } from '@nestjs/common';
import { AccessService } from '@darkbeacon/access';
import { ForbiddenError, requireAccount, type Actor } from '@darkbeacon/core';

/**
 * Who may list accounts and the bot's Discord servers, roles and channels: people who manage
 * something that needs a picker, i.e. instance admins and admins of at least one map.
 */
@Injectable()
export class PickerAccess {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  async require(actor: Actor | null): Promise<void> {
    const account = requireAccount(actor);
    if (account.instanceRole === 'owner' || account.instanceRole === 'admin') return;
    const maps = await this.access.mapsFor(account);
    if (maps.some((m) => m.role === 'admin')) return;
    throw new ForbiddenError('Only map admins can look this up');
  }
}
