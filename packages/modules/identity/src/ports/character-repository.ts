import type { CharacterTokens, LinkedCharacter } from '../domain/account.js';

export interface CharacterRepository {
  findById(characterId: number): Promise<LinkedCharacter | null>;
  listForAccount(accountId: string): Promise<LinkedCharacter[]>;
  upsert(character: LinkedCharacter): Promise<void>;
  /**
   * Updates what token use learns (affiliation, token validity) while the character still
   * belongs to `accountId`. False when it does not (unlinked or claimed meanwhile).
   */
  updateState(
    characterId: number,
    accountId: string,
    state: Partial<Pick<LinkedCharacter, 'corporationId' | 'allianceId' | 'tokenValid'>> & {
      updatedAt: number;
    },
  ): Promise<boolean>;
  delete(characterId: number): Promise<void>;
  saveTokens(characterId: number, tokens: CharacterTokens): Promise<void>;
  getTokens(characterId: number): Promise<CharacterTokens | null>;
  /** The scopes each character's token was granted (no secrets are read). */
  scopesOf(characterIds: readonly number[]): Promise<Map<number, string[]>>;
}
