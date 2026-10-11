import { ManualClock } from '@wormwright/core';
import type {
  CharacterRepository,
  CharacterTokens,
  EveSso,
  EveTokenSet,
  LinkedCharacter,
} from '@wormwright/identity';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityCharacterTokens } from './identity-character-tokens.js';

const PILOT = 90000001;

describe('IdentityCharacterTokens', () => {
  let clock: ManualClock;
  let character: LinkedCharacter;
  let stored: CharacterTokens | null;
  let refreshes: string[];
  let refreshResult: () => Promise<EveTokenSet>;
  let source: IdentityCharacterTokens;

  beforeEach(() => {
    clock = new ManualClock(1_000_000);
    character = {
      id: PILOT,
      accountId: 'alice',
      name: 'Pilot',
      corporationId: 1,
      allianceId: null,
      ownerHash: 'hash',
      tokenValid: true,
      linkedAt: 0,
      updatedAt: 0,
    };
    stored = { accessToken: 'old', refreshToken: 'r1', expiresAt: clock.now() + 20 * 60_000, scopes: [] };
    refreshes = [];
    refreshResult = () =>
      Promise.resolve({
        accessToken: 'new',
        refreshToken: 'r2',
        expiresAt: clock.now() + 20 * 60_000,
        identity: { characterId: PILOT, characterName: 'Pilot', ownerHash: 'hash', scopes: ['s'] },
      });
    const characters = {
      findById: (id: number) => Promise.resolve(id === PILOT ? character : null),
      getTokens: () => Promise.resolve(stored),
      saveTokens: (_: number, tokens: CharacterTokens) => {
        stored = tokens;
        return Promise.resolve();
      },
    } as unknown as CharacterRepository;
    const sso = {
      refresh: (token: string) => {
        refreshes.push(token);
        return refreshResult();
      },
    } as unknown as EveSso;
    source = new IdentityCharacterTokens(characters, sso, clock);
  });

  it('names the owner of a linked character', async () => {
    expect(await source.character(PILOT)).toEqual({ name: 'Pilot', accountId: 'alice' });
    expect(await source.character(1)).toBeNull();
  });

  it('returns a valid token as is', async () => {
    expect(await source.accessToken(PILOT)).toBe('old');
    expect(refreshes).toEqual([]);
  });

  it('refreshes a token about to expire once, even when asked twice', async () => {
    clock.advance(19 * 60_000 + 30_000);
    const [a, b] = await Promise.all([source.accessToken(PILOT), source.accessToken(PILOT)]);
    expect([a, b]).toEqual(['new', 'new']);
    expect(refreshes).toEqual(['r1']);
    expect(stored).toMatchObject({ accessToken: 'new', refreshToken: 'r2', scopes: ['s'] });
  });

  it('gives no token for invalid or unlinked characters or when the refresh fails', async () => {
    expect(await source.accessToken(1)).toBeNull();
    clock.advance(30 * 60_000);
    refreshResult = () => Promise.reject(new Error('invalid_grant'));
    expect(await source.accessToken(PILOT)).toBeNull();
    character.tokenValid = false;
    expect(await source.accessToken(PILOT)).toBeNull();
  });
});
