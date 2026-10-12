import type { AccessRules, InstanceSettingsService } from '@darkbeacon/access';
import { isInstanceAdmin, type Actor } from '@darkbeacon/core';
import type { AccountService } from '@darkbeacon/identity';
import type { MapDirectory } from '@darkbeacon/mapping';

/** Mapping's `MapDirectory`, answered by identity (accounts) and access (settings, rules). */
export class InstanceMapDirectory implements MapDirectory {
  constructor(
    private readonly accounts: AccountService,
    private readonly settings: InstanceSettingsService,
    private readonly rules: AccessRules,
  ) {}

  async accountNames(accountIds: readonly string[]): Promise<Map<string, string>> {
    const found = await this.accounts.names(accountIds);
    return new Map([...found].map(([id, account]) => [id, account.name]));
  }

  async mayCreateMaps(actor: Actor): Promise<boolean> {
    const { mapCreation } = await this.settings.current();
    return mapCreation !== 'admins' || isInstanceAdmin(actor);
  }

  accessRuleCounts(): Promise<Map<string, number>> {
    return this.rules.ruleCounts();
  }
}
