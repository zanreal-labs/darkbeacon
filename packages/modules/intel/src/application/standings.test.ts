import { describe, expect, it } from 'vitest';
import { ManualClock, type Actor } from '@darkbeacon/core';
import { standingTone, statusFromStanding } from '@darkbeacon/shared';
import { mergeStandings } from '../domain/standings.js';
import type { ContactsSource, StandingPilots } from '../ports/index.js';
import { CONTACT_SCOPES, Standings } from './standings.js';

const ALL = Object.values(CONTACT_SCOPES);
const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };

describe('standings', () => {
  it('lets alliance contacts win over corporation and character ones, and the main over alts', () => {
    const merged = mergeStandings([
      {
        characterId: 1,
        corporationId: 98000001,
        allianceId: 99000001,
        character: [
          { id: 500, standing: -10 },
          { id: 600, standing: 5 },
        ],
        corporation: [{ id: 500, standing: -5 }],
        alliance: [{ id: 500, standing: 10 }],
      },
      {
        characterId: 2,
        corporationId: 98000002,
        allianceId: null,
        character: [
          { id: 600, standing: -10 },
          { id: 700, standing: -5 },
        ],
        corporation: null,
        alliance: null,
      },
    ]);
    expect(merged.get(500)).toBe(10);
    expect(merged.get(600)).toBe(5);
    expect(merged.get(700)).toBe(-5);
    // Own alliance and corporations are blue.
    expect(merged.get(99000001)).toBe(10);
    expect(merged.get(98000002)).toBe(10);
  });

  it('colours and derives a status the way the game and the old mapper did', () => {
    expect([10, 6, 5, 0.5, 0, -0.5, -5, -6, -10].map(standingTone)).toEqual([
      'excellent',
      'excellent',
      'good',
      'good',
      'neutral',
      'bad',
      'bad',
      'terrible',
      'terrible',
    ]);
    expect([10, 5, 4.9, -4.9, -5, -9.9, -10, null].map(statusFromStanding)).toEqual([
      'friendly',
      'friendly',
      null,
      null,
      'warning',
      'warning',
      'hostile',
      null,
    ]);
  });

  it('reads each list once with a character that has the scope, and says when scopes are missing', async () => {
    const calls: string[] = [];
    const pilots: StandingPilots = {
      characters: async () => [
        { id: 1, corporationId: 98000001, allianceId: 99000001, scopes: ALL },
        { id: 2, corporationId: 98000001, allianceId: 99000001, scopes: ALL },
        { id: 3, corporationId: 98000003, allianceId: null, scopes: ['esi-location.read_location.v1'] },
      ],
      accessToken: async (id) => `token-${id}`,
    };
    const contacts: ContactsSource = {
      contacts: async (owner, token) => {
        calls.push(`${owner.kind}:${owner.id}:${token}`);
        return { ok: true, data: [{ id: 4242, standing: owner.kind === 'alliance' ? -10 : 5 }], nextAt: 0 };
      },
    };
    const clock = new ManualClock();
    const standings = new Standings({ pilots, contacts, clock });
    const result = await standings.forAccount(alice);
    expect(calls.sort()).toEqual([
      'alliance:99000001:token-1',
      'character:1:token-1',
      'character:2:token-2',
      'corporation:98000001:token-1',
    ]);
    expect(result.missingScopes).toBe(true);
    expect(new Map(result.standings.map((s) => [s.id, s.standing])).get(4242)).toBe(-10);
    await standings.forAccount(alice);
    expect(calls).toHaveLength(4);
    await expect(standings.forAccount(null)).rejects.toThrow();
  });

  it('lets a standing set by hand win over contacts until it is cleared', async () => {
    const stored = new Map<number, number>();
    const standings = new Standings({
      pilots: {
        characters: async () => [{ id: 1, corporationId: 98000001, allianceId: null, scopes: ALL }],
        accessToken: async () => 'tok',
      },
      contacts: { contacts: async () => ({ ok: true, data: [{ id: 99000666, standing: 5 }], nextAt: 0 }) },
      clock: new ManualClock(),
      overrides: {
        standingOverrides: async () => new Map(stored),
        setStandingOverride: async (_account, id, standing) => {
          if (standing === null) stored.delete(id);
          else stored.set(id, standing);
        },
      },
    });
    const of = (dto: { standings: Array<{ id: number; standing: number }> }) =>
      new Map(dto.standings.map((s) => [s.id, s.standing])).get(99000666);
    expect(of(await standings.forAccount(alice))).toBe(5);
    const set = await standings.set(alice, 99000666, -25);
    expect(of(set)).toBe(-10);
    expect(set.overrides).toEqual([99000666]);
    const cleared = await standings.set(alice, 99000666, null);
    expect(of(cleared)).toBe(5);
    expect(cleared.overrides).toEqual([]);
  });
});
