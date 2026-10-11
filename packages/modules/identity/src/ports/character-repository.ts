import type { CharacterTokens, LinkedCharacter } from '../domain/account.js';

export interface CharacterRepository {
  findById(characterId: number): Promise<LinkedCharacter | null>;
  listForAccount(accountId: string): Promise<LinkedCharacter[]>;
  upsert(character: LinkedCharacter): Promise<void>;
  delete(characterId: number): Promise<void>;
  saveTokens(characterId: number, tokens: CharacterTokens): Promise<void>;
  getTokens(characterId: number): Promise<CharacterTokens | null>;
}
