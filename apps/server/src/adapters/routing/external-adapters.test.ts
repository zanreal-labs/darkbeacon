import { describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { ANSIBLEX_TYPE_ID, EsiStructuresError, farSideOf, TheraFeed } from '@darkbeacon/routing';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import {
  AccountAlliances,
  CORPORATION_STRUCTURES_SCOPE,
  EsiAnsiblexSearch,
  EsiCorporationStructures,
  EsiSovereignty,
  HttpEveScoutClient,
  KspaceDistances,
  StaticInvasionLookup,
  STRUCTURE_SEARCH_SCOPE,
  UNIVERSE_STRUCTURES_SCOPE,
} from './external-adapters.js';

const universe = StaticUniverseCatalog.load('/nonexistent');

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

/** One signature as https://api.eve-scout.com/v2/public/signatures answered on 2026-10-12. */
const SIGNATURE = {
  id: '75676',
  signature_type: 'wormhole',
  wh_type: 'Q063',
  wh_exits_outward: true,
  max_ship_size: 'medium',
  expires_at: '2026-10-13T02:00:00.000Z',
  remaining_hours: 3,
  out_system_id: 31000005,
  out_system_name: 'Thera',
  out_signature: 'ABC-123',
  in_system_id: 30000144,
  in_system_name: 'Perimeter',
  in_system_class: 'hs',
  in_region_id: 10000002,
  in_region_name: 'The Forge',
  in_signature: 'XYZ-987',
};

describe('EVE-Scout', () => {
  it('reads Thera and Turnur holes and gives the router their edges', async () => {
    const urls: string[] = [];
    const client = new HttpEveScoutClient({
      userAgent: 'test',
      fetch: (async (url: string) => {
        urls.push(url);
        return json([SIGNATURE, { ...SIGNATURE, id: '2', signature_type: 'combat' }]);
      }) as typeof fetch,
    });
    const clock = new ManualClock(Date.parse('2026-10-12T23:00:00Z'));
    const feed = new TheraFeed({ client, universe, clock });
    expect(await feed.refresh()).toBe(true);
    expect(urls).toEqual(['https://api.eve-scout.com/v2/public/signatures']);
    expect(feed.connections()).toMatchObject([
      { hub: 'thera', name: 'Perimeter', regionName: 'The Forge', whType: 'Q063', signature: 'XYZ-987' },
    ]);
    expect(await feed.edges()).toMatchObject([
      {
        a: 31000005,
        b: 30000144,
        via: 'wormhole',
        origin: 'eve-scout',
        state: { timeStatus: 'eol', shipSize: 'medium' },
      },
    ]);
    expect(await feed.refresh()).toBe(false);
    clock.advance(4 * 60 * 60_000);
    expect(feed.connections()).toEqual([]);
  });
});

describe('ESI', () => {
  it('reads the Ansiblexes of a corporation, page by page', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const structures = (status = 200) =>
      new EsiCorporationStructures({
        userAgent: 'test',
        scopes: async () => [CORPORATION_STRUCTURES_SCOPE],
        accessToken: async () => 'token',
        fetch: (async (url: string, init?: RequestInit) => {
          calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
          if (url.endsWith('/characters/9001')) return json({ corporation_id: 98000001 });
          if (status !== 200) return json({ error: 'no' }, { status });
          const page = Number(new URL(url).searchParams.get('page'));
          return json(
            page === 1
              ? [
                  { structure_id: 1, type_id: 35841, system_id: 30004759, name: '1DQ1-A » UALX-3 - Home' },
                  { structure_id: 2, type_id: 35832, system_id: 30004759, name: 'Astrahus' },
                ]
              : [{ structure_id: 3, type_id: 35841, system_id: 30004750 }],
            { headers: { 'x-pages': '2' } },
          );
        }) as typeof fetch,
      });
    expect(await structures().ansiblexes(9001)).toEqual([
      { structureId: 1, solarSystemId: 30004759, name: '1DQ1-A » UALX-3 - Home' },
      { structureId: 3, solarSystemId: 30004750, name: null },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://esi.evetech.net/characters/9001',
      'https://esi.evetech.net/corporations/98000001/structures?page=1',
      'https://esi.evetech.net/corporations/98000001/structures?page=2',
    ]);
    expect(calls[1]!.auth).toBe('Bearer token');
    await expect(structures(403).ansiblexes(9001)).rejects.toMatchObject({ reason: 'forbidden' });
    await expect(
      new EsiCorporationStructures({
        userAgent: 't',
        scopes: async () => [],
        accessToken: async () => 't',
      }).ansiblexes(1),
    ).rejects.toBeInstanceOf(EsiStructuresError);
  });

  describe('Ansiblexes a character may use', () => {
    const idOf = (name: string) => [...universe.systems()].find((s) => s.name === name)?.id ?? null;
    const DQ = idOf('1DQ1-A')!;
    const O4 = idOf('4O-239')!;
    const CHARACTER = 9001;
    /** What `GET /universe/structures/{id}` answers per structure (as the ESI spec describes it). */
    const STRUCTURES: Record<number, { status: number; body: unknown }> = {
      1020000000001: {
        status: 200,
        body: { name: '1DQ1-A » 4O-239 - Home', owner_id: 98000002, solar_system_id: DQ, type_id: 35841 },
      },
      // Another alliance's gate: the character is not on its access list.
      1020000000002: { status: 403, body: { error: 'Forbidden' } },
      1020000000003: {
        status: 200,
        body: { name: '1DQ1-A » Market', owner_id: 98000002, solar_system_id: DQ, type_id: 35832 },
      },
      // `type_id` is optional in the spec; the name tells.
      1020000000004: {
        status: 200,
        body: { name: '4O-239 » 1DQ1-A - Back', owner_id: 98000003, solar_system_id: O4 },
      },
    };

    const setup = (
      options: { scopes?: string[]; search?: number; limit?: (url: string) => Record<string, string> } = {},
    ) => {
      const calls: Array<{ url: string; auth: string | null }> = [];
      const clock = new ManualClock();
      const sleeps: number[] = [];
      const search = new EsiAnsiblexSearch({
        userAgent: 'test',
        clock,
        scopes: async () => options.scopes ?? [STRUCTURE_SEARCH_SCOPE, UNIVERSE_STRUCTURES_SCOPE],
        accessToken: async () => 'token',
        sleep: async (ms) => {
          sleeps.push(ms);
          clock.advance(ms);
        },
        fetch: (async (url: string, init?: RequestInit) => {
          calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
          const headers = options.limit?.(url) ?? {};
          if (url.includes('/search?')) {
            if (options.search) return json({ error: 'no' }, { status: options.search, headers });
            return json({ structure: Object.keys(STRUCTURES).map(Number) }, { headers });
          }
          const id = Number(url.split('/').at(-1));
          const answer = STRUCTURES[id]!;
          return json(answer.body, { status: answer.status, headers });
        }) as typeof fetch,
      });
      return { search, calls, clock, sleeps };
    };

    it('searches " » ", reads every hit and keeps the Ansiblexes, skipping a refused one', async () => {
      const { search, calls, clock } = setup();
      const gates = await search.ansiblexes(CHARACTER);
      expect(gates).toEqual([
        { structureId: 1020000000001, solarSystemId: DQ, name: '1DQ1-A » 4O-239 - Home' },
        { structureId: 1020000000004, solarSystemId: O4, name: '4O-239 » 1DQ1-A - Back' },
      ]);
      expect(ANSIBLEX_TYPE_ID).toBe(35841);
      const first = new URL(calls[0]!.url);
      expect(first.pathname).toBe(`/characters/${CHARACTER}/search`);
      expect(first.searchParams.get('categories')).toBe('structure');
      expect(first.searchParams.get('search')).toBe(' » ');
      expect(
        calls
          .slice(1)
          .map((c) => new URL(c.url).pathname)
          .sort(),
      ).toEqual(Object.keys(STRUCTURES).map((id) => `/universe/structures/${id}`));
      expect(calls.every((c) => c.auth === 'Bearer token')).toBe(true);
      // The far side comes from the name, as for the corporation's gates.
      expect(gates.map((g) => farSideOf(g.name!, g.solarSystemId, idOf))).toEqual([O4, DQ]);

      // Kept for a while, then asked again.
      await search.ansiblexes(CHARACTER);
      expect(calls).toHaveLength(5);
      clock.advance(16 * 60_000);
      await search.ansiblexes(CHARACTER);
      expect(calls).toHaveLength(10);
    });

    it('says which scope is missing and when EVE refuses the search', async () => {
      await expect(
        setup({ scopes: [STRUCTURE_SEARCH_SCOPE, CORPORATION_STRUCTURES_SCOPE] }).search.ansiblexes(
          CHARACTER,
        ),
      ).rejects.toMatchObject({ reason: 'no-scope' });
      await expect(setup({ search: 403 }).search.ansiblexes(CHARACTER)).rejects.toMatchObject({
        reason: 'forbidden',
      });
      await expect(setup({ search: 502 }).search.ansiblexes(CHARACTER)).rejects.toBeInstanceOf(
        EsiStructuresError,
      );
    });

    it("waits for ESI's error window when few errors are left", async () => {
      // The search leaves 5 errors in a window resetting in 30 s: nothing is sent before then.
      const { search, calls, sleeps } = setup({
        limit: (url) =>
          url.includes('/search?')
            ? { 'x-esi-error-limit-remain': '5', 'x-esi-error-limit-reset': '30' }
            : { 'x-esi-error-limit-remain': '100', 'x-esi-error-limit-reset': '60' },
      });
      expect(await search.ansiblexes(CHARACTER)).toHaveLength(2);
      expect(sleeps).toEqual([31_000]);
      expect(calls).toHaveLength(5);
    });
  });

  it('reads who holds each system and keeps it for an hour', async () => {
    const urls: string[] = [];
    const clock = new ManualClock();
    const sov = new EsiSovereignty({
      userAgent: 'test',
      clock,
      fetch: (async (url: string, init?: RequestInit) => {
        urls.push(`${url} ${new Headers(init?.headers).get('x-compatibility-date')}`);
        return json({
          solar_systems: [
            {
              solar_system_id: 30004759,
              claim: { alliance: { alliance_id: 1900696668, corporation_id: 1 } },
            },
            { solar_system_id: 30000001, claim: { faction: { faction_id: 500007 } } },
            { solar_system_id: 30000002, claim: { unclaimed: {} } },
          ],
        });
      }) as typeof fetch,
    });
    expect(sov.holderOf(30004759)).toBeNull();
    expect(await sov.refresh()).toBe(true);
    expect(await sov.refresh()).toBe(false);
    expect(sov.holderOf(30004759)).toBe(1900696668);
    expect(sov.holderOf(30000001)).toBeNull();
    expect(urls).toEqual(['https://esi.evetech.net/sovereignty/systems 2026-08-18']);
    clock.advance(60 * 60_000);
    expect(await sov.refresh()).toBe(true);
  });

  it('measures light years between known-space systems', () => {
    const distances = KspaceDistances.load();
    // T5ZI-S and 1DQ1-A (Delve) are 1.4 ly apart, PR-8CA and 1DQ1-A 5.6 ly, Jita and 1DQ1-A 51 ly.
    expect(distances.lightYears(30004735, 30004759)).toBeCloseTo(1.4, 1);
    expect(distances.lightYears(30004711, 30004759)).toBeCloseTo(5.63, 1);
    expect(distances.lightYears(30000142, 30004759)).toBeGreaterThan(5);
    expect(distances.lightYears(30000142, 31000005)).toBeNull();
  });
});

describe('static data and identity', () => {
  it("takes the main character's alliance", async () => {
    const alliances = new AccountAlliances({
      mainCharacterOf: async () => 2,
      charactersOf: async () => [
        { id: 1, allianceId: 10 },
        { id: 2, allianceId: 20 },
      ],
    });
    expect(await alliances.allianceOf('a')).toBe(20);
    const noMain = new AccountAlliances({
      mainCharacterOf: async () => null,
      charactersOf: async () => [
        { id: 1, allianceId: null },
        { id: 2, allianceId: 20 },
      ],
    });
    expect(await noMain.allianceOf('a')).toBe(20);
  });

  it("takes the pilot's alliance when the account owns the pilot", async () => {
    const alliances = new AccountAlliances({
      mainCharacterOf: async () => 2,
      charactersOf: async () => [
        { id: 1, allianceId: 10 },
        { id: 2, allianceId: 20 },
        { id: 3, allianceId: null },
      ],
    });
    expect(await alliances.allianceOf('a', 1)).toBe(10);
    expect(await alliances.allianceOf('a', 3)).toBeNull();
    // Someone else's character: the main's.
    expect(await alliances.allianceOf('a', 99)).toBe(20);
  });

  it('knows how the invasion left a system', () => {
    const invasions = StaticInvasionLookup.load();
    expect(invasions.of(30001372)).toBe('final'); // Kino, now in Pochven
    expect(invasions.of(30000142)).toBeNull(); // Jita
  });
});
