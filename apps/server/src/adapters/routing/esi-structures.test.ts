import { describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { EsiStructuresError, STRUCTURE_SEARCH_SCOPE, UNIVERSE_STRUCTURES_SCOPE } from '@darkbeacon/routing';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';
import {
  EsiAccessStructureSearch,
  EsiErrorLimit,
  EsiPublicStructures,
  EsiStructureReader,
} from './esi-structures.js';

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

const PERIMETER = 30000144;
const JITA = 30000142;

/** What `GET /universe/structures/{id}` answers per structure (as the ESI spec describes it). */
const STRUCTURES: Record<number, { status: number; body: unknown }> = {
  1035466617946: {
    status: 200,
    body: {
      name: 'Perimeter - Tranquility Trading Tower',
      owner_id: 98000001,
      solar_system_id: PERIMETER,
      type_id: 35834,
    },
  },
  // Not on its access list.
  1035466617947: { status: 403, body: { error: 'Forbidden' } },
  // Named after Perimeter, standing in Jita.
  1035466617948: {
    status: 200,
    body: { name: 'Perimeter - Moved', owner_id: 98000001, solar_system_id: JITA, type_id: 35832 },
  },
  // An Ansiblex: the bridges show it.
  1035466617949: {
    status: 200,
    body: {
      name: 'Perimeter » Jita - Bridge',
      owner_id: 98000002,
      solar_system_id: PERIMETER,
      type_id: 35841,
    },
  },
  // `type_id` is optional.
  1035466617950: {
    status: 200,
    body: { name: 'Perimeter - No type', owner_id: 98000003, solar_system_id: PERIMETER },
  },
  1035466617951: { status: 404, body: { error: 'Not found' } },
  1035466617952: { status: 502, body: { error: 'Bad gateway' } },
};

const setup = (
  options: {
    scopes?: string[];
    search?: number | number[];
    list?: number;
    limit?: (url: string) => Record<string, string>;
  } = {},
) => {
  const calls: Array<{ url: string; auth: string | null; date: string | null }> = [];
  const clock = new ManualClock();
  const sleeps: number[] = [];
  const reader = new EsiStructureReader({
    userAgent: 'test',
    limit: new EsiErrorLimit({
      clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    }),
    fetch: (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get('authorization'), date: headers.get('x-compatibility-date') });
      const limit = options.limit?.(url) ?? {};
      if (url.includes('/search?')) {
        if (typeof options.search === 'number')
          return json({ error: 'no' }, { status: options.search, headers: limit });
        return json({ structure: options.search ?? Object.keys(STRUCTURES).map(Number) }, { headers: limit });
      }
      if (url.endsWith('/universe/structures')) {
        if (options.list) return json({ error: 'no' }, { status: options.list, headers: limit });
        return json([1035466617946, 1035466617950], { headers: limit });
      }
      const answer = STRUCTURES[Number(url.split('/').at(-1))]!;
      return json(answer.body, { status: answer.status, headers: limit });
    }) as typeof fetch,
  });
  const search = new EsiAccessStructureSearch({
    reader,
    clock,
    scopes: async () => options.scopes ?? [STRUCTURE_SEARCH_SCOPE, UNIVERSE_STRUCTURES_SCOPE],
    accessToken: async () => 'token',
  });
  return { reader, search, calls, clock, sleeps };
};

describe('ESI structures', () => {
  it('lists public structures without a login and reads their details with one', async () => {
    const { reader, calls } = setup();
    const source = new EsiPublicStructures(reader);
    expect(await source.publicIds()).toEqual([1035466617946, 1035466617950]);
    expect(calls[0]).toEqual({
      url: 'https://esi.evetech.net/universe/structures',
      auth: null,
      date: ESI_COMPATIBILITY_DATE,
    });
    const reads = await source.read(
      [1035466617946, 1035466617947, 1035466617950, 1035466617951, 1035466617952],
      'token',
    );
    expect(reads).toEqual({
      found: [
        {
          structureId: 1035466617946,
          name: 'Perimeter - Tranquility Trading Tower',
          solarSystemId: PERIMETER,
          typeId: 35834,
          ownerCorporationId: 98000001,
        },
        {
          structureId: 1035466617950,
          name: 'Perimeter - No type',
          solarSystemId: PERIMETER,
          typeId: null,
          ownerCorporationId: 98000003,
        },
      ],
      refused: expect.arrayContaining([1035466617947, 1035466617951]),
      failed: [1035466617952],
    });
    expect(calls.slice(1).every((c) => c.auth === 'Bearer token')).toBe(true);
  });

  it('says when the list cannot be read', async () => {
    await expect(new EsiPublicStructures(setup({ list: 503 }).reader).publicIds()).rejects.toBeInstanceOf(
      EsiStructuresError,
    );
  });

  it("searches a system's name and keeps the structures standing there, Ansiblexes left out", async () => {
    const { search, calls, clock } = setup({
      search: [1035466617946, 1035466617947, 1035466617948, 1035466617949, 1035466617950],
    });
    const found = await search.structuresIn(9001, { id: PERIMETER, name: 'Perimeter' });
    expect(found.map((s) => s.structureId)).toEqual([1035466617946, 1035466617950]);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe('/characters/9001/search');
    expect(first.searchParams.get('categories')).toBe('structure');
    expect(first.searchParams.get('search')).toBe('Perimeter');
    expect(calls).toHaveLength(6);

    // Kept for a while per character and system, then asked again.
    await search.structuresIn(9001, { id: PERIMETER, name: 'Perimeter' });
    expect(calls).toHaveLength(6);
    await search.structuresIn(9002, { id: PERIMETER, name: 'Perimeter' });
    expect(calls).toHaveLength(12);
    clock.advance(16 * 60_000);
    await search.structuresIn(9001, { id: PERIMETER, name: 'Perimeter' });
    expect(calls).toHaveLength(18);
  });

  it('says which scope is missing, when EVE refuses the search and when it fails', async () => {
    const perimeter = { id: PERIMETER, name: 'Perimeter' };
    await expect(
      setup({ scopes: [STRUCTURE_SEARCH_SCOPE] }).search.structuresIn(9001, perimeter),
    ).rejects.toMatchObject({ reason: 'no-scope' });
    await expect(setup({ search: 403 }).search.structuresIn(9001, perimeter)).rejects.toMatchObject({
      reason: 'forbidden',
    });
    await expect(
      setup({ search: [1035466617952] }).search.structuresIn(9001, perimeter),
    ).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it("waits for ESI's error window when few errors are left, and after a 420", async () => {
    const { search, calls, sleeps } = setup({
      search: [1035466617946],
      limit: (url) =>
        url.includes('/search?')
          ? { 'x-esi-error-limit-remain': '5', 'x-esi-error-limit-reset': '30' }
          : { 'x-esi-error-limit-remain': '100', 'x-esi-error-limit-reset': '60' },
    });
    expect(await search.structuresIn(9001, { id: PERIMETER, name: 'Perimeter' })).toHaveLength(1);
    expect(sleeps).toEqual([31_000]);
    expect(calls).toHaveLength(2);

    // A 420 spends the window: the next request waits a minute.
    const clock = new ManualClock();
    const waited: number[] = [];
    const limit = new EsiErrorLimit({
      clock,
      sleep: async (ms) => {
        waited.push(ms);
        clock.advance(ms);
      },
    });
    await limit.send(async () => json({ error: 'limited' }, { status: 420 }));
    await limit.send(async () => json({}));
    expect(waited).toEqual([61_000]);
  });
});
