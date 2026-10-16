import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ManualClock,
  type Actor,
  type EventLog,
  type NewEvent,
} from '@darkbeacon/core';
import type { UniverseSystemDto } from '@darkbeacon/shared';
import { EsiStructuresError } from '../domain/bridges.js';
import type {
  AnsiblexStructure,
  BridgeRecord,
  BridgeRepository,
  CharacterStructureSearch,
  CorporationStructures,
  NewBridge,
  RoutingUniverse,
} from '../ports/index.js';
import { BridgeAdmin } from './bridges.js';

const system = (id: number, name: string, security = -0.4): UniverseSystemDto => ({
  id,
  name,
  regionName: 'Delve',
  constellationName: 'C',
  security,
  whClass: null,
  statics: [],
  effect: null,
});
const SYSTEMS = [
  system(1, 'AAA-1'),
  system(2, 'BBB-2'),
  system(3, 'CCC-3'),
  system(4, 'Jita', 0.9),
  system(5, '3-LJW3'),
  system(6, 'M-ZJWJ'),
  system(7, 'PQRE-W'),
  system(8, 'A-7XFN'),
];
const universe: RoutingUniverse = {
  getSystem: (id) => SYSTEMS.find((s) => s.id === id) ?? null,
  systems: () => SYSTEMS,
  gateNeighbours: () => [],
};

class MemoryBridges implements BridgeRepository {
  rows: BridgeRecord[] = [];
  async list(mapId: string) {
    return this.rows.filter((b) => b.mapId === mapId);
  }
  async find(mapId: string, id: string) {
    return this.rows.find((b) => b.mapId === mapId && b.id === id) ?? null;
  }
  async upsert(bridges: readonly NewBridge[], options: { id(): string; now: number }) {
    const added: BridgeRecord[] = [];
    const updated: BridgeRecord[] = [];
    for (const bridge of bridges) {
      const known = this.rows.find((b) => b.mapId === bridge.mapId && b.a === bridge.a && b.b === bridge.b);
      if (known) {
        updated.push(Object.assign(known, bridge));
        continue;
      }
      const row = { ...bridge, id: options.id(), createdAt: options.now } as BridgeRecord;
      this.rows.push(row);
      added.push(row);
    }
    return { added, updated, known: updated.length };
  }
  async setDangerous() {
    return null;
  }
  async remove() {}
  async forgetMap() {}
}

const gate = (structureId: number, solarSystemId: number, name: string | null): AnsiblexStructure => ({
  structureId,
  solarSystemId,
  name,
});

const MANAGER: Actor = { kind: 'account', id: 'acc', instanceRole: 'user' };
const CHARACTER = 9001;

function setup(sources: {
  corporation: () => Promise<AnsiblexStructure[]>;
  search?: () => Promise<AnsiblexStructure[]>;
}) {
  const bridges = new MemoryBridges();
  const events: NewEvent[] = [];
  let next = 0;
  const structures: CorporationStructures = { ansiblexes: sources.corporation };
  const search: CharacterStructureSearch | undefined = sources.search && { ansiblexes: sources.search };
  const admin = new BridgeAdmin({
    bridges,
    universe,
    structures,
    ...(search ? { search } : {}),
    pilots: {
      ownerOf: async (id) => (id === CHARACTER ? 'acc' : null),
      securityStatus: async () => 0,
      scopes: async () => [],
      accessToken: async () => null,
      charactersOf: async () => [],
    },
    access: { roleOf: async () => 'manager', mapsFor: async () => [] },
    events: {
      append: async (list: readonly NewEvent[]) => {
        events.push(...list);
        return [];
      },
    } as unknown as EventLog,
    uow: { transaction: (work) => work() },
    clock: new ManualClock(),
    newId: () => `b${++next}`,
  });
  return { admin, bridges, events };
}

const refused = (reason: EsiStructuresError['reason']) => () =>
  Promise.reject(new EsiStructuresError(reason, reason));

describe('finding jump bridges in EVE', () => {
  it("merges the character's search with its corporation's gates, once per structure and pair", async () => {
    const { admin, bridges, events } = setup({
      corporation: async () => [gate(10, 1, 'AAA-1 » BBB-2 - Corp')],
      search: async () => [
        gate(10, 1, 'AAA-1 » BBB-2 - Corp'), // the same structure
        gate(11, 2, 'BBB-2 » AAA-1 - Back'), // the far end of the same bridge
        gate(12, 1, 'AAA-1 » CCC-3 - Alliance'),
        gate(13, 3, 'Renamed gate'),
        gate(14, 1, 'AAA-1 » Jita'),
      ],
    });
    const result = await admin.readFromEsi(MANAGER, 'm', CHARACTER);
    expect(result).toMatchObject({ added: 2, known: 0, found: 5 });
    expect(result.notes).toBeUndefined();
    expect(result.unreadable).toEqual([
      { line: 0, text: 'Renamed gate', reason: 'Its name does not say where it leads' },
      { line: 0, text: 'AAA-1 » Jita', reason: 'Jita is not in null-sec, where Ansiblexes stand' },
    ]);
    expect(bridges.rows.map((b) => [b.a, b.b, b.structureId, b.source])).toEqual([
      [1, 2, 10, 'esi'],
      [1, 3, 12, 'esi'],
    ]);
    expect(events.map((e) => e.type)).toEqual(['routes.bridges_changed']);
  });

  it('uses the search alone when the corporation read is refused (no Station Manager role)', async () => {
    const { admin } = setup({
      corporation: refused('forbidden'),
      search: async () => [gate(12, 1, 'AAA-1 » CCC-3 - Alliance')],
    });
    expect(await admin.readFromEsi(MANAGER, 'm', CHARACTER)).toMatchObject({ added: 1, found: 1 });
  });

  it("reads the corporation's gates and says how to find the alliance's without the scope", async () => {
    const { admin } = setup({
      corporation: async () => [gate(10, 1, 'AAA-1 » BBB-2 - Corp')],
      search: refused('no-scope'),
    });
    const result = await admin.readFromEsi(MANAGER, 'm', CHARACTER);
    expect(result).toMatchObject({ added: 1, found: 1 });
    expect(result.notes).toEqual([expect.stringContaining('Link the character again')]);
  });

  it('says nothing was found', async () => {
    const { admin } = setup({ corporation: refused('forbidden'), search: async () => [] });
    expect(await admin.readFromEsi(MANAGER, 'm', CHARACTER)).toMatchObject({ added: 0, found: 0 });
  });

  it('asks to link the character again when neither read works', async () => {
    const { admin } = setup({ corporation: refused('forbidden'), search: refused('no-scope') });
    const error = await admin.readFromEsi(MANAGER, 'm', CHARACTER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toBe('Link the character again to let Darkbeacon find jump bridges');
    const down = setup({ corporation: refused('forbidden'), search: refused('unavailable') });
    await expect(down.admin.readFromEsi(MANAGER, 'm', CHARACTER)).rejects.toBeInstanceOf(ConflictError);
    // Without the search, the corporation's messages as before.
    const corporationOnly = setup({ corporation: refused('forbidden') });
    await expect(corporationOnly.admin.readFromEsi(MANAGER, 'm', CHARACTER)).rejects.toThrow(
      /Station Manager/,
    );
  });

  it('imports pasted lines with only a space, a tab, a comma or a dash between the names', async () => {
    const { admin, bridges } = setup({ corporation: async () => [] });
    const result = await admin.paste(MANAGER, 'm', {
      text: [
        'PQRE-W A-7XFN',
        '3-LJW3 M-ZJWJ',
        'AAA-1\tBBB-2',
        'CCC-3,AAA-1',
        'BBB-2-CCC-3',
        'AAA-1 Nowhere',
      ].join('\n'),
      dangerous: false,
    });
    expect(result).toMatchObject({ added: 5, unknownSystems: ['Nowhere'], unreadable: [] });
    expect(bridges.rows.map((b) => [b.a, b.b])).toEqual([
      [7, 8],
      [5, 6],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });

  it("refuses someone else's character", async () => {
    const { admin } = setup({ corporation: async () => [], search: async () => [] });
    await expect(admin.readFromEsi(MANAGER, 'm', 1)).rejects.toThrow(/Character/);
  });
});
