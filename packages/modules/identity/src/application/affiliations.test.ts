import { ManualClock } from '@darkbeacon/core';
import { describe, expect, it } from 'vitest';
import type { LinkedCharacter } from '../domain/account.js';
import {
  addStrike,
  grantedExtras,
  linkScopes,
  missingScopes,
  OPTIONAL_EVE_SCOPES,
  parseExtras,
  TOKEN_STRIKES,
} from '../domain/rules.js';
import { AffiliationRefresh } from './affiliations.js';
import { toCharacterDto } from './accounts.js';
import { immediateUow, MemoryCharacters, MemoryEventLog } from './testing.js';

const character = (
  id: number,
  accountId: string,
  corporationId: number,
  over: Partial<LinkedCharacter> = {},
) => ({
  id,
  accountId,
  name: `c${id}`,
  corporationId,
  allianceId: null,
  ownerHash: 'h',
  tokenValid: true,
  linkedAt: 0,
  updatedAt: 0,
  ...over,
});

describe('AffiliationRefresh', () => {
  it('stores corporation changes and marks only the changed accounts', async () => {
    const characters = new MemoryCharacters();
    await characters.upsert(character(1, 'a', 10));
    await characters.upsert(character(2, 'b', 20));
    await characters.upsert(character(3, 'c', 30, { ownerHash: 'dev' }));
    const events = new MemoryEventLog();
    const asked: number[][] = [];
    const refresh = new AffiliationRefresh({
      characters,
      events,
      uow: immediateUow,
      clock: new ManualClock(5),
      esi: {
        affiliations: (ids) => {
          asked.push([...ids]);
          return Promise.resolve(
            new Map([
              [1, { corporationId: 11, allianceId: 99 }],
              [2, { corporationId: 20, allianceId: null }],
            ]),
          );
        },
      },
    });
    expect(await refresh.run()).toBe(1);
    // Made-up demo characters are never sent to ESI.
    expect(asked).toEqual([[1, 2]]);
    expect(await characters.findById(1)).toMatchObject({ corporationId: 11, allianceId: 99 });
    expect(events.events.map((e) => [e.type, e.data])).toEqual([
      ['access.account_changed', { accountId: 'a' }],
    ]);
  });
});

describe('scopes of a character', () => {
  it('asks for the extras on top of the required scopes and says what a grant lacks', () => {
    expect(parseExtras('wallet, nope,assets')).toEqual(['assets', 'wallet']);
    expect(parseExtras(undefined)).toEqual([]);
    expect(linkScopes(['wallet'])).toContain(OPTIONAL_EVE_SCOPES.wallet);
    const old = ['esi-location.read_location.v1', OPTIONAL_EVE_SCOPES.assets];
    expect(missingScopes(old)).toContain('esi-characters.read_contacts.v1');
    expect(missingScopes(linkScopes())).toEqual([]);
    expect(grantedExtras(old)).toEqual(['assets']);
    const dto = toCharacterDto(character(1, 'a', 10), old);
    expect(dto.extras).toEqual(['assets']);
    expect(dto.missingScopes?.length).toBeGreaterThan(0);
    // Without a grant nothing is known, so nothing is missing.
    expect(toCharacterDto(character(1, 'a', 10)).missingScopes).toBeUndefined();
  });

  it('counts refresh refusals within a window', () => {
    const first = addStrike(undefined, 0);
    const second = addStrike(first, 1000);
    expect(second).toEqual({ count: 2, firstAt: 0 });
    expect(addStrike(second, TOKEN_STRIKES.windowMs + 1)).toEqual({
      count: 1,
      firstAt: TOKEN_STRIKES.windowMs + 1,
    });
  });
});
