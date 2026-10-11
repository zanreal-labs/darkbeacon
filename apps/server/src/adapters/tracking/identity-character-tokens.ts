import type { Clock } from '@wormwright/core';
import type { CharacterRepository, EveSso } from '@wormwright/identity';
import type { CharacterTokenSource } from '@wormwright/tracking';

/** Refresh access tokens this long before they expire. */
const REFRESH_MARGIN = 60_000;

/**
 * CharacterTokenSource composed from the identity module's ports: reads the stored EVE tokens
 * of a linked character and refreshes them through EVE SSO when they are about to expire.
 */
export class IdentityCharacterTokens implements CharacterTokenSource {
  private readonly refreshing = new Map<number, Promise<string | null>>();

  constructor(
    private readonly characters: CharacterRepository,
    private readonly sso: EveSso,
    private readonly clock: Clock,
    private readonly onError: (error: unknown, characterId: number) => void = () => {},
  ) {}

  async character(characterId: number): Promise<{ name: string; accountId: string } | null> {
    const character = await this.characters.findById(characterId);
    return character ? { name: character.name, accountId: character.accountId } : null;
  }

  async accessToken(characterId: number): Promise<string | null> {
    const character = await this.characters.findById(characterId);
    if (!character?.tokenValid) return null;
    const tokens = await this.characters.getTokens(characterId);
    if (!tokens) return null;
    if (tokens.expiresAt - REFRESH_MARGIN > this.clock.now()) return tokens.accessToken;

    // One refresh per character at a time; refresh tokens may be single use.
    let pending = this.refreshing.get(characterId);
    if (!pending) {
      pending = this.refresh(characterId, tokens.refreshToken).finally(() =>
        this.refreshing.delete(characterId),
      );
      this.refreshing.set(characterId, pending);
    }
    return pending;
  }

  private async refresh(characterId: number, refreshToken: string): Promise<string | null> {
    try {
      const fresh = await this.sso.refresh(refreshToken);
      if (fresh.identity.characterId !== characterId) return null;
      await this.characters.saveTokens(characterId, {
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        expiresAt: fresh.expiresAt,
        scopes: fresh.identity.scopes,
      });
      return fresh.accessToken;
    } catch (error) {
      this.onError(error, characterId);
      return null;
    }
  }
}
