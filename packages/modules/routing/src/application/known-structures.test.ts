import { describe, expect, it } from 'vitest';
import { ManualClock, UnauthenticatedError, type Actor } from '@darkbeacon/core';
import type { StationDto, UniverseSystemDto } from '@darkbeacon/shared';
import { EsiStructuresError } from '../domain/bridges.js';
import {
  mergeKnownStructures,
  STRUCTURE_SEARCH_SCOPE,
  UNIVERSE_STRUCTURES_SCOPE,
  type UpwellStructure,
} from '../domain/structures.js';
import type {
  AccessStructureSearch,
  PublicStructureRepository,
  PublicStructureSource,
  StructureReads,
} from '../ports/index.js';
import { KnownStructures, PublicStructureCatalog } from './known-structures.js';

const VIEWER: Actor = { kind: 'account', id: 'acc', instanceRole: 'user' };
const BOTH = [STRUCTURE_SEARCH_SCOPE, UNIVERSE_STRUCTURES_SCOPE];
const DAY = 24 * 60 * 60_000;

const system = (id: number, name: string): UniverseSystemDto => ({
  id,
  name,
  regionName: 'R',
  constellationName: 'C',
  security: 0.5,
  whClass: null,
  statics: [],
  effect: null,
});
const SYSTEMS = [system(1, 'Perimeter'), system(2, 'Jita'), system(3, 'Ex')];

const structure = (
  structureId: number,
  name: string,
  solarSystemId = 1,
  typeId: number | null = 35832,
  ownerCorporationId: number | null = 98000001,
): UpwellStructure => ({ structureId, name, solarSystemId, typeId, ownerCorporationId });

const station = (id: number, name: string, solarSystemId = 1): StationDto => ({
  id,
  name,
  solarSystemId,
  main: false,
});

class MemoryPublic implements PublicStructureRepository {
  rows = new Map<number, UpwellStructure & { readAt: number; listedAt: number }>();
  async inSystems(ids: readonly number[]) {
    return [...this.rows.values()].filter((r) => ids.includes(r.solarSystemId));
  }
  async readTimes() {
    return new Map([...this.rows.values()].map((r) => [r.structureId, r.readAt]));
  }
  async save(rows: readonly UpwellStructure[], readAt: number) {
    for (const r of rows)
      this.rows.set(r.structureId, {
        ...r,
        readAt,
        listedAt: this.rows.get(r.structureId)?.listedAt ?? readAt,
      });
  }
  async remove(ids: readonly number[]) {
    for (const id of ids) this.rows.delete(id);
  }
  async markListed(now: number) {
    for (const r of this.rows.values()) r.listedAt = now;
  }
  async listedAt() {
    const all = [...this.rows.values()].map((r) => r.listedAt);
    return all.length === 0 ? null : Math.max(...all);
  }
}

describe('merging known structures', () => {
  it('lists stations first, then structures by name, each once, without Ansiblex gates', () => {
    const merged = mergeKnownStructures({
      stations: [
        station(60000002, 'Perimeter II - Moon 1 - Station'),
        station(60000001, 'Perimeter I - Station'),
      ],
      public: [
        structure(1001, 'Perimeter - Tatara', 1, 35836),
        structure(1002, 'Perimeter - Keepstar', 1, 35834, null),
      ],
      access: [
        // Public too: shown once, as public.
        structure(1001, 'Perimeter - Tatara', 1, 35836),
        structure(1003, 'Perimeter - Alliance Astrahus', 1, 35832, 98000002),
        structure(1004, 'Perimeter » Jita - Bridge', 1, 35841),
        structure(1005, 'Perimeter » Ex - Unknown type', 1, null),
        structure(1006, 'Perimeter - Odd', 1, 99999),
      ],
      owners: new Map([[98000001, { name: 'Corp One', ticker: 'ONE' }]]),
    });
    expect(merged.map((s) => [s.id, s.source])).toEqual([
      [60000001, 'npc'],
      [60000002, 'npc'],
      [1003, 'access'],
      [1002, 'public'],
      [1006, 'access'],
      [1001, 'public'],
    ]);
    expect(merged[0]).toEqual({
      id: 60000001,
      name: 'Perimeter I - Station',
      solarSystemId: 1,
      typeId: null,
      typeName: null,
      owner: null,
      source: 'npc',
    });
    expect(merged.find((s) => s.id === 1001)).toMatchObject({
      typeName: 'Tatara',
      owner: { id: 98000001, name: 'Corp One', ticker: 'ONE' },
    });
    expect(merged.find((s) => s.id === 1003)).toMatchObject({
      typeName: 'Astrahus',
      owner: { id: 98000002, name: null, ticker: null },
    });
    expect(merged.find((s) => s.id === 1002)).toMatchObject({ typeName: 'Keepstar', owner: null });
    expect(merged.find((s) => s.id === 1006)).toMatchObject({ typeId: 99999, typeName: null });
  });
});

describe('known structures of systems', () => {
  const setup = (
    options: {
      characters?: Array<{ id: number; scopes: string[] }>;
      search?: (characterId: number, system: { id: number; name: string }) => Promise<UpwellStructure[]>;
    } = {},
  ) => {
    const publicStructures = new MemoryPublic();
    const searched: Array<[number, string]> = [];
    const characters = options.characters ?? [{ id: 9001, scopes: BOTH }];
    const search: AccessStructureSearch = {
      structuresIn: async (characterId, s) => {
        searched.push([characterId, s.name]);
        return options.search ? options.search(characterId, s) : [];
      },
    };
    const owned: number[][] = [];
    const known = new KnownStructures({
      stations: { stationsIn: (id) => (id === 1 ? [station(60000001, 'Perimeter I - Station')] : []) },
      universe: { getSystem: (id) => SYSTEMS.find((s) => s.id === id) ?? null },
      publicStructures,
      search,
      pilots: {
        charactersOf: async () => characters.map((c) => ({ id: c.id, name: `P${c.id}` })),
        scopes: async (id) => characters.find((c) => c.id === id)?.scopes ?? [],
      },
      owners: {
        corporations: async (ids) => {
          owned.push([...ids]);
          return new Map(ids.map((id) => [id, { name: `Corp ${id}`, ticker: `T${id % 1000}` }]));
        },
      },
    });
    return { known, publicStructures, searched, owned };
  };

  it('merges stations, the public catalogue and what the characters may use, owners named', async () => {
    const { known, publicStructures, searched, owned } = setup({
      characters: [
        { id: 9001, scopes: BOTH },
        { id: 9002, scopes: [STRUCTURE_SEARCH_SCOPE] },
      ],
      search: async (_, s) => (s.id === 1 ? [structure(2001, 'Perimeter - Home', 1, 35825, 98000003)] : []),
    });
    await publicStructures.save(
      [structure(1001, 'Perimeter - Market', 1, 35833), structure(1009, 'Jita - X', 2)],
      0,
    );
    const result = await known.list(VIEWER, [1, 1]);
    expect(result.access).toBeNull();
    expect(result.structures.map((s) => [s.id, s.source, s.owner?.name ?? null])).toEqual([
      [60000001, 'npc', null],
      [2001, 'access', 'Corp 98000003'],
      [1001, 'public', 'Corp 98000001'],
    ]);
    // Only the character with both scopes searches, once per system.
    expect(searched).toEqual([[9001, 'Perimeter']]);
    expect(owned).toEqual([[98000001, 98000003]]);
  });

  it('says when no character may search structures, and skips names too short to search', async () => {
    const none = setup({ characters: [{ id: 9001, scopes: [UNIVERSE_STRUCTURES_SCOPE] }] });
    expect(await none.known.list(VIEWER, [1])).toMatchObject({ access: 'scope' });
    expect(none.searched).toEqual([]);

    const short = setup();
    expect(await short.known.list(VIEWER, [3, 2])).toEqual({ structures: [], access: null });
    expect(short.searched).toEqual([[9001, 'Jita']]);
  });

  it('says when EVE failed, keeping what the other searches found', async () => {
    const { known } = setup({
      characters: [
        { id: 9001, scopes: BOTH },
        { id: 9002, scopes: BOTH },
      ],
      search: async (characterId) => {
        if (characterId === 9001) throw new EsiStructuresError('unavailable', 'EVE did not answer');
        return [structure(2001, 'Perimeter - Home')];
      },
    });
    const result = await known.list(VIEWER, [1]);
    expect(result.access).toBe('unavailable');
    expect(result.structures.map((s) => s.id)).toEqual([60000001, 2001]);
  });

  it('ignores a grant that lost a scope meanwhile', async () => {
    const { known } = setup({
      search: async () => {
        throw new EsiStructuresError('no-scope', 'gone');
      },
    });
    expect((await known.list(VIEWER, [1])).access).toBeNull();
  });

  it('wants a signed-in account', async () => {
    await expect(setup().known.list(null, [1])).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('public structure catalogue', () => {
  const setup = (
    options: { characters?: number[]; tokens?: Record<number, string | null>; listed?: number[] } = {},
  ) => {
    const clock = new ManualClock(10 * DAY);
    const repo = new MemoryPublic();
    const reads: number[][] = [];
    let listed = options.listed ?? [1001, 1002, 1003];
    const details: Record<number, UpwellStructure | 'refused' | 'failed'> = {
      1001: structure(1001, 'Perimeter - A'),
      1002: structure(1002, 'Jita - B', 2),
      1003: 'refused',
      1004: 'failed',
      1005: structure(1005, 'Perimeter - C'),
    };
    const tokensAsked: number[] = [];
    const source: PublicStructureSource = {
      publicIds: async () => listed,
      read: async (ids, token) => {
        expect(token).toBe('token');
        reads.push([...ids]);
        const result: StructureReads = { found: [], refused: [], failed: [] };
        for (const id of ids) {
          const d = details[id];
          if (d === 'refused') result.refused.push(id);
          else if (d === 'failed' || !d) result.failed.push(id);
          else result.found.push(d);
        }
        return result;
      },
    };
    const catalog = new PublicStructureCatalog({
      repo,
      source,
      characters: {
        withScopes: async (scopes) => {
          expect(scopes).toEqual([UNIVERSE_STRUCTURES_SCOPE]);
          return options.characters ?? [9001];
        },
      },
      tokens: {
        accessToken: async (id) => {
          tokensAsked.push(id);
          return options.tokens ? (options.tokens[id] ?? null) : 'token';
        },
      },
      clock,
    });
    return { catalog, repo, reads, clock, tokensAsked, list: (ids: number[]) => (listed = ids) };
  };

  it('reads new structures, keeps them a week, drops unlisted ones and runs about daily', async () => {
    const { catalog, repo, reads, clock, list } = setup();
    expect(await catalog.refresh()).toEqual({ listed: 3, read: 2, removed: 1, failed: 0 });
    expect(reads).toEqual([[1001, 1002, 1003]]);
    expect([...repo.rows.keys()].sort()).toEqual([1001, 1002]);
    expect(await repo.listedAt()).toBe(clock.now());

    // Not due yet.
    clock.advance(DAY / 2);
    expect(await catalog.refresh()).toBeNull();

    // A day later: only the new one is read; one no longer listed is dropped.
    clock.advance(DAY);
    list([1001, 1004, 1005]);
    expect(await catalog.refresh()).toEqual({ listed: 3, read: 1, removed: 1, failed: 1 });
    expect(reads[1]).toEqual([1004, 1005]);
    expect([...repo.rows.keys()].sort()).toEqual([1001, 1005]);

    // A week after its read, a structure is read again.
    clock.advance(7 * DAY + 60_000);
    list([1001, 1005]);
    await catalog.refresh();
    expect(reads[2]).toEqual([1001, 1005]);
  });

  it('reads nothing without a character that may read structures', async () => {
    const nobody = setup({ characters: [] });
    expect(await nobody.catalog.refresh()).toBeNull();
    expect(nobody.reads).toEqual([]);

    const second = setup({ characters: [9001, 9002], tokens: { 9001: null, 9002: 'token' } });
    expect(await second.catalog.refresh({ force: true })).not.toBeNull();
    expect(second.tokensAsked).toEqual([9001, 9002]);
  });
});
