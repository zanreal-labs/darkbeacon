import { describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { EsiStructuresError, TheraFeed } from '@darkbeacon/routing';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import {
  AccountAlliances,
  CORPORATION_STRUCTURES_SCOPE,
  EsiCorporationStructures,
  EsiSovereignty,
  HttpEveScoutClient,
  StaticInvasionLookup,
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

  it('keeps the sovereignty map for an hour', async () => {
    let reads = 0;
    const clock = new ManualClock();
    const sov = new EsiSovereignty({
      userAgent: 'test',
      clock,
      fetch: (async () => {
        reads++;
        return json([
          { system_id: 30004759, alliance_id: 1354830081 },
          { system_id: 30000142, faction_id: 500001 },
        ]);
      }) as typeof fetch,
    });
    expect(sov.holderOf(30004759)).toBeNull();
    expect(await sov.refresh()).toBe(true);
    expect(await sov.refresh()).toBe(false);
    expect(sov.holderOf(30004759)).toBe(1354830081);
    expect(sov.holderOf(30000142)).toBeNull();
    clock.advance(60 * 60_000);
    expect(await sov.refresh()).toBe(true);
    expect(reads).toBe(2);
  });

  it('falls back to the sovereignty hubs when the map does not answer', async () => {
    const sov = new EsiSovereignty({
      userAgent: 'test',
      clock: new ManualClock(),
      fetch: (async (url: string) =>
        url.endsWith('/sovereignty/map')
          ? json({ error: 'Page not found' }, { status: 404 })
          : json([
              { solar_system_id: 30004759, alliance_id: 1354830081, structure_type_id: 32458 },
            ])) as typeof fetch,
    });
    expect(await sov.refresh()).toBe(true);
    expect(sov.holderOf(30004759)).toBe(1354830081);
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

  it('knows how the invasion left a system', () => {
    const invasions = StaticInvasionLookup.load();
    expect(invasions.of(30001372)).toBe('final'); // Kino, now in Pochven
    expect(invasions.of(30000142)).toBeNull(); // Jita
  });
});
