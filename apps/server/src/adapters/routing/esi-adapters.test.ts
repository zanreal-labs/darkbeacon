import { describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { WAYPOINT_SCOPE, Waypoints } from '@darkbeacon/routing';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { EsiPilotDirectory, HttpWaypointGateway, type CharacterLookup } from './esi-adapters.js';

const JITA = 30000142;

function recorder(answer: (url: string) => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const characters = (scopes: string[], token: string | null = 'token'): CharacterLookup => ({
  character: async (id) => (id === 9001 ? { name: 'Pilot', accountId: 'alice' } : null),
  scopes: async () => scopes,
  accessToken: async () => token,
});

describe('ESI adapters for routing', () => {
  it('reads security status from ESI and keeps it for an hour', async () => {
    const clock = new ManualClock();
    const net = recorder((url) =>
      url.endsWith('/9001')
        ? Response.json({ name: 'Pilot', security_status: -3.4 })
        : new Response('{"error":"not found"}', { status: 404 }),
    );
    const pilots = new EsiPilotDirectory({
      characters: characters([]),
      clock,
      userAgent: 'test',
      fetch: net.fetch,
    });
    expect(await pilots.securityStatus(9001)).toBe(-3.4);
    expect(await pilots.securityStatus(9001)).toBe(-3.4);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]!.url).toBe('https://esi.evetech.net/characters/9001');
    expect(new Headers(net.calls[0]!.init?.headers).get('x-compatibility-date')).toBe('2026-08-18');
    clock.advance(60 * 60 * 1000 + 1);
    await pilots.securityStatus(9001);
    expect(net.calls).toHaveLength(2);
    expect(await pilots.securityStatus(4)).toBeNull();
    expect(await pilots.ownerOf(9001)).toBe('alice');
    expect(await pilots.ownerOf(4)).toBeNull();
  });

  it('sets the destination through ESI for a character whose grant allows it', async () => {
    const net = recorder(() => new Response(null, { status: 204 }));
    const universe = StaticUniverseCatalog.load('/nonexistent');
    const waypoints = (scopes: string[], token: string | null = 'token') =>
      new Waypoints({
        pilots: new EsiPilotDirectory({
          characters: characters(scopes, token),
          clock: new ManualClock(),
          userAgent: 'test',
          fetch: net.fetch,
        }),
        gateway: new HttpWaypointGateway({ userAgent: 'test', fetch: net.fetch }),
        universe,
      });
    const alice = { kind: 'account', id: 'alice', instanceRole: 'user' } as const;

    await waypoints([WAYPOINT_SCOPE]).set(alice, 9001, { solarSystemId: JITA, mode: 'destination' });
    expect(net.calls[0]!.url).toBe(
      `https://esi.evetech.net/ui/autopilot/waypoint?add_to_beginning=false&clear_other_waypoints=true&destination_id=${JITA}`,
    );
    expect(net.calls[0]!.init?.method).toBe('POST');
    expect(new Headers(net.calls[0]!.init?.headers).get('authorization')).toBe('Bearer token');
    await waypoints([WAYPOINT_SCOPE]).set(alice, 9001, { solarSystemId: JITA, mode: 'waypoint' });
    expect(net.calls[1]!.url).toContain('clear_other_waypoints=false');

    await expect(
      waypoints([]).set(alice, 9001, { solarSystemId: JITA, mode: 'destination' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      waypoints([WAYPOINT_SCOPE], null).set(alice, 9001, { solarSystemId: JITA, mode: 'destination' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      waypoints([WAYPOINT_SCOPE]).set({ ...alice, id: 'bob' }, 9001, {
        solarSystemId: JITA,
        mode: 'destination',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      waypoints([WAYPOINT_SCOPE]).set(alice, 9001, { solarSystemId: 1, mode: 'destination' }),
    ).rejects.toMatchObject({ code: 'validation' });

    const refusing = recorder(() => new Response('{}', { status: 502 }));
    await expect(
      new Waypoints({
        pilots: new EsiPilotDirectory({
          characters: characters([WAYPOINT_SCOPE]),
          clock: new ManualClock(),
          userAgent: 't',
        }),
        gateway: new HttpWaypointGateway({ userAgent: 'test', fetch: refusing.fetch }),
        universe,
      }).set(alice, 9001, { solarSystemId: JITA, mode: 'destination' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
