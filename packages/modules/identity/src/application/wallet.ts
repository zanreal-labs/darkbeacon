import { NotFoundError, requireAccount, ValidationError, type Actor, type Clock } from '@darkbeacon/core';
import type { CharacterWalletDto } from '@darkbeacon/shared';
import { OPTIONAL_EVE_SCOPES } from '../domain/rules.js';
import type { EveWallet } from '../ports/eve-public.js';
import type { CharacterService } from './characters.js';

/** How long a balance is shown before ESI is asked again (Wanderer reads it every 10 minutes). */
const WALLET_TTL_MS = 10 * 60 * 1000;

/** The balance of one of my characters, for those that granted the wallet extra. */
export class CharacterWallets {
  private readonly cache = new Map<number, CharacterWalletDto>();

  constructor(private readonly deps: { characters: CharacterService; wallet: EveWallet; clock: Clock }) {}

  async balance(actor: Actor | null, characterId: number): Promise<CharacterWalletDto> {
    const account = requireAccount(actor);
    const own = await this.deps.characters.character(characterId);
    if (own?.accountId !== account.id) throw new NotFoundError('Character');
    const now = this.deps.clock.now();
    const cached = this.cache.get(characterId);
    if (cached && now - cached.checkedAt < WALLET_TTL_MS) return cached;
    const scopes = await this.deps.characters.scopes(characterId);
    if (!scopes.includes(OPTIONAL_EVE_SCOPES.wallet))
      throw new ValidationError('This character has not allowed Darkbeacon to read its wallet');
    const token = await this.deps.characters.accessToken(characterId);
    const balance = token ? await this.deps.wallet.balance(characterId, token) : null;
    const result = { characterId, balance, checkedAt: now };
    if (balance !== null) this.cache.set(characterId, result);
    return result;
  }
}
