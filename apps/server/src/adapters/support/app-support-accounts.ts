import type { AccountService, CharacterService } from '@darkbeacon/identity';
import type { AccountCharacter, SupportAccounts } from '@darkbeacon/support';

/**
 * The hub's accounts are the instance's own: the characters linked to an account with EVE SSO,
 * each with the owner hash the app stored at its last sign-in or link. The main character comes
 * first (the oldest link when the account has none set).
 */
export class AppSupportAccounts implements SupportAccounts {
  constructor(
    private readonly accounts: Pick<AccountService, 'find'>,
    private readonly linked: Pick<CharacterService, 'listForAccount'>,
  ) {}

  async characters(accountId: string): Promise<AccountCharacter[]> {
    const [account, linked] = await Promise.all([
      this.accounts.find(accountId),
      this.linked.listForAccount(accountId),
    ]);
    if (!account || linked.length === 0) return [];
    const main = linked.some((c) => c.id === account.mainCharacterId)
      ? account.mainCharacterId
      : linked[0]!.id;
    return linked
      .map((c) => ({ characterId: c.id, characterName: c.name, ownerHash: c.ownerHash, main: c.id === main }))
      .sort((a, b) => Number(b.main) - Number(a.main));
  }
}
