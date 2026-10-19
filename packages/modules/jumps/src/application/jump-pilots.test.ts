import { describe, expect, it } from 'vitest';
import { ManualClock, NotFoundError, type Actor } from '@darkbeacon/core';
import { JUMP_PILOT_SCOPES, PilotEsiError } from '../domain/pilot.js';
import type { JumpPilotCharacters, JumpPilotEsi } from '../ports/index.js';
import { JumpPilots } from './jump-pilots.js';

const PILOT = 2112000001;
const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
const bob: Actor = { kind: 'account', id: 'bob', instanceRole: 'user' };
const MINUTE = 60_000;

function setup(
  options: {
    scopes?: string[];
    skills?: () => Promise<Map<number, number>>;
    fatigue?: () => Promise<number | null>;
  } = {},
) {
  const clock = new ManualClock();
  const asked: string[] = [];
  const characters: JumpPilotCharacters = {
    character: async (id) => (id === PILOT ? { name: 'Alice Pilot', accountId: 'alice' } : null),
    scopes: async () => options.scopes ?? Object.values(JUMP_PILOT_SCOPES),
  };
  const esi: JumpPilotEsi = {
    skillLevels: (id) => {
      asked.push(`skills ${id}`);
      return options.skills?.() ?? Promise.resolve(new Map([[21611, 4]]));
    },
    fatigueExpiry: (id) => {
      asked.push(`fatigue ${id}`);
      return options.fatigue?.() ?? Promise.resolve(null);
    },
  };
  return { pilots: new JumpPilots({ characters, esi, clock }), clock, asked };
}

describe('JumpPilots', () => {
  it('reads active levels, untrained skills as 0, and the fatigue left', async () => {
    const { pilots, clock } = setup({
      // Alpha clones: ESI's active level is capped below the trained one, and that is what counts.
      skills: async () =>
        new Map([
          [21611, 5],
          [21610, 3],
        ]),
      fatigue: async () => clock.now() + 42.5 * MINUTE,
    });
    expect(await pilots.pilot(alice, PILOT)).toEqual({
      characterId: PILOT,
      skills: { jdc: 5, jfc: 3, jf: 0 },
      fatigueMinutes: 43,
      fatigueExpiresAt: clock.now() + 42.5 * MINUTE,
      missingScopes: [],
      problem: null,
      checkedAt: clock.now(),
    });
  });

  it('caps fatigue at 5 hours and reads fatigue that ran out as none', async () => {
    let expiry = Date.UTC(2026, 0, 1) + 9 * 60 * MINUTE;
    const { pilots, clock } = setup({ fatigue: async () => expiry });
    expect((await pilots.pilot(alice, PILOT)).fatigueMinutes).toBe(300);
    expiry = clock.now() - MINUTE;
    expect(await pilots.pilot(alice, PILOT)).toMatchObject({ fatigueMinutes: 0, fatigueExpiresAt: null });
  });

  it('names the scopes the grant lacks and asks ESI only for what it covers', async () => {
    const { pilots, asked } = setup({ scopes: [JUMP_PILOT_SCOPES.fatigue] });
    expect(await pilots.pilot(alice, PILOT)).toMatchObject({
      skills: null,
      fatigueMinutes: 0,
      missingScopes: ['esi-skills.read_skills.v1'],
      problem: null,
    });
    expect(asked).toEqual([`fatigue ${PILOT}`]);

    const none = setup({ scopes: [] });
    expect(await none.pilots.pilot(alice, PILOT)).toMatchObject({
      skills: null,
      fatigueMinutes: null,
      missingScopes: ['esi-skills.read_skills.v1', 'esi-characters.read_fatigue.v1'],
    });
    expect(none.asked).toEqual([]);
  });

  it('keeps the part ESI answered for and says why the other is missing', async () => {
    const { pilots } = setup({
      fatigue: () => Promise.reject(new PilotEsiError('unavailable', 'ESI answered 503')),
    });
    expect(await pilots.pilot(alice, PILOT)).toMatchObject({
      skills: { jdc: 4, jfc: 0, jf: 0 },
      fatigueMinutes: null,
      problem: 'EVE did not answer; try again in a moment.',
    });
    const refused = setup({ skills: () => Promise.reject(new PilotEsiError('forbidden', '403')) });
    expect((await refused.pilots.pilot(alice, PILOT)).problem).toMatch(/link the character again/);
  });

  it('answers only for my own characters', async () => {
    const { pilots, asked } = setup();
    await expect(pilots.pilot(bob, PILOT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pilots.pilot(alice, 95000001)).rejects.toBeInstanceOf(NotFoundError);
    expect(asked).toEqual([]);
  });
});
