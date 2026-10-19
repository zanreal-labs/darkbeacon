import { describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { PilotEsiError } from '@darkbeacon/jumps';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';
import { EsiJumpPilot } from './esi-jump-pilot.js';

const PILOT = 2112000001;

/** The two answers as https://esi.evetech.net/meta/openapi.json (2026-08-18) shapes them. */
const SKILLS = {
  skills: [
    { skill_id: 21611, active_skill_level: 4, trained_skill_level: 5, skillpoints_in_skill: 1_280_000 },
    { skill_id: 3300, active_skill_level: 5, trained_skill_level: 5, skillpoints_in_skill: 256_000 },
  ],
  total_sp: 50_000_000,
};
const FATIGUE = {
  jump_fatigue_expire_date: '2026-10-19T12:42:00Z',
  last_jump_date: '2026-10-19T11:30:00Z',
  last_update_date: '2026-10-19T11:30:00Z',
};

function setup(answer: (url: string) => Response | Promise<Response>, token: string | null = 'token-1') {
  const clock = new ManualClock(Date.parse('2026-10-19T12:00:00Z'));
  const calls: Array<{ url: string; headers: Headers }> = [];
  const pilot = new EsiJumpPilot({
    clock,
    userAgent: 'test',
    accessToken: async () => token,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers) });
      return answer(url);
    }) as typeof fetch,
  });
  return { pilot, clock, calls };
}

describe('ESI jump skills and fatigue', () => {
  it('reads active skill levels and the fatigue expiry with the character’s login', async () => {
    const { pilot, calls } = setup((url) => Response.json(url.endsWith('/skills') ? SKILLS : FATIGUE));
    expect(await pilot.skillLevels(PILOT)).toEqual(
      new Map([
        [21611, 4],
        [3300, 5],
      ]),
    );
    expect(await pilot.fatigueExpiry(PILOT)).toBe(Date.parse('2026-10-19T12:42:00Z'));
    expect(calls.map((c) => c.url)).toEqual([
      `https://esi.evetech.net/characters/${PILOT}/skills`,
      `https://esi.evetech.net/characters/${PILOT}/fatigue`,
    ]);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer token-1');
    expect(calls[0]!.headers.get('x-compatibility-date')).toBe(ESI_COMPATIBILITY_DATE);
  });

  it('reads no fatigue when ESI names no expiry', async () => {
    const { pilot } = setup(() => Response.json({}));
    expect(await pilot.fatigueExpiry(PILOT)).toBeNull();
  });

  it('keeps an answer until it expires, at most as long as ESI caches it', async () => {
    const { pilot, clock, calls } = setup((url) =>
      Response.json(url.endsWith('/skills') ? SKILLS : FATIGUE, {
        headers: { expires: new Date(clock.now() + 30_000).toUTCString() },
      }),
    );
    await pilot.skillLevels(PILOT);
    await pilot.skillLevels(PILOT);
    expect(calls).toHaveLength(1);
    clock.advance(31_000);
    await pilot.skillLevels(PILOT);
    expect(calls).toHaveLength(2);

    const late = setup(() =>
      Response.json(FATIGUE, { headers: { expires: 'Fri, 01 Jan 2100 00:00:00 GMT' } }),
    );
    await late.pilot.fatigueExpiry(PILOT);
    late.clock.advance(299_000);
    await late.pilot.fatigueExpiry(PILOT);
    expect(late.calls).toHaveLength(1);
    late.clock.advance(2_000);
    await late.pilot.fatigueExpiry(PILOT);
    expect(late.calls).toHaveLength(2);
  });

  it('says why nothing came: refused, no login, no answer', async () => {
    const reason = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => (e instanceof PilotEsiError ? e.reason : 'other'),
      );
    expect(await reason(setup(() => new Response(null, { status: 403 })).pilot.skillLevels(PILOT))).toBe(
      'forbidden',
    );
    expect(await reason(setup(() => new Response(null, { status: 503 })).pilot.fatigueExpiry(PILOT))).toBe(
      'unavailable',
    );
    expect(
      await reason(
        setup(() => {
          throw new TypeError('fetch failed');
        }).pilot.skillLevels(PILOT),
      ),
    ).toBe('unavailable');
    const noLogin = setup(() => Response.json(SKILLS), null);
    expect(await reason(noLogin.pilot.skillLevels(PILOT))).toBe('no-token');
    expect(noLogin.calls).toEqual([]);
  });
});
