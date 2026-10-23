import { describe, expect, it } from 'vitest';
import type { Actor, MapAccess } from '@darkbeacon/core';
import type { ChainEntry, MapRole, StampedValue } from '@darkbeacon/shared';
import type { ChainCommand } from '../domain/commands.js';
import { ChainMerge } from '../domain/merge.js';
import { SELF, type SourceInfo } from '../domain/view.js';
import type { ChainSource, ChainWriteContext, LocalFields } from '../ports/index.js';
import type { ChainMerger } from './merger.js';
import type { SharingPorts } from './ports.js';
import { ChainWrites } from './writes.js';

const J1 = 31000001;
const s = (v: unknown, at: number): StampedValue => ({ v, at });
const system = (fields: Record<string, StampedValue> = {}): ChainEntry => ({
  kind: 'system',
  key: String(J1),
  state: 'present',
  born: 1,
  fields,
});
const person = (id: string): Actor => ({ kind: 'account', id, instanceRole: 'user' });

const corpA: SourceInfo = {
  id: 'share-a',
  origin: { instance: 'local', mapId: 'corp-a' },
  name: 'Corp A',
  instanceName: null,
  level: 'read-write',
  scopes: ['topology'],
  hidden: false,
};

/** A composite merging Corp A, which locks J1; roles by `person|map`. */
function setup(options: { localLock?: boolean; sourceLock?: boolean } = {}) {
  const merge = new ChainMerge();
  merge.setSource(SELF, 0);
  merge.setSource(corpA.id, 1);
  merge.apply(corpA.id, [system({ locked: s(options.sourceLock ?? true, 2) })]);
  const roles = new Map<string, MapRole>([
    ['dave|alliance', 'member'],
    ['carol|alliance', 'admin'],
    ['alice|alliance', 'member'],
    ['alice|corp-a', 'manager'],
  ]);
  const access: MapAccess = {
    roleOf: (actor, mapId) => Promise.resolve(roles.get(`${actor.id}|${mapId}`) ?? null),
    mapsFor: () => Promise.resolve([]),
  };
  const writes: Array<{ command: ChainCommand; context: ChainWriteContext; mapId: string }> = [];
  const adapter = (mapId: string): ChainSource => ({
    origin: { instance: 'local', mapId },
    read: () => Promise.reject(new Error('not read in these tests')),
    passages: () => Promise.resolve([]),
    write: (command, context) => {
      writes.push({ command, context, mapId });
      return Promise.resolve();
    },
  });
  const local = new Map<number, LocalFields>(
    options.localLock ? [[J1, { notes: null, labelIds: [], locked: true }]] : [],
  );
  const state = {
    mapId: 'alliance',
    info: {
      origin: { instance: 'local', mapId: 'alliance' },
      name: 'Alliance chain',
      slug: null,
      kind: 'composite',
    },
    sources: [
      {
        id: SELF,
        origin: { instance: 'local', mapId: 'alliance' },
        name: 'Alliance chain',
        instanceName: null,
        level: 'read-write',
        scopes: 'all',
        hidden: false,
      },
      corpA,
    ],
    merge,
    local,
  };
  const calls = { setLocal: [] as Array<Partial<LocalFields>>, moves: 0 };
  const merger = {
    state: () => Promise.resolve(state),
    setLocal: (_who: Actor, _mapId: string, _id: number, patch: Partial<LocalFields>) => {
      calls.setLocal.push(patch);
      return Promise.resolve();
    },
    move: () => {
      calls.moves += 1;
      return Promise.resolve();
    },
  } as unknown as ChainMerger;
  const ports = {
    access,
    sources: { source: (origin: { mapId: string }) => adapter(origin.mapId) },
  } as unknown as SharingPorts;
  return { chain: new ChainWrites(ports, merger), writes, calls };
}

describe('merged writes and locks held by sources', () => {
  it('refuses removing and moving a system a source locks, naming that map, before writing anything', async () => {
    const { chain, writes, calls } = setup();
    const named = { code: 'conflict', message: expect.stringMatching(/locked on Corp A/) };
    await expect(chain.removeSystem(person('dave'), 'alliance', J1)).rejects.toMatchObject(named);
    await expect(
      chain.updateSystem(person('dave'), 'alliance', J1, { visible: false }),
    ).rejects.toMatchObject(named);
    await expect(
      chain.moveSystems(person('dave'), 'alliance', { positions: [{ solarSystemId: J1, x: 1, y: 1 }] }),
    ).rejects.toMatchObject({ code: 'conflict', details: { lockedOn: ['Corp A'] } });
    expect(writes).toEqual([]);
    expect(calls.moves).toBe(0);
  });

  it('lets anyone but a manager of the source keep their hands off its lock, the composite’s admin too', async () => {
    const { chain, writes, calls } = setup();
    for (const who of ['dave', 'carol'])
      await expect(chain.updateSystem(person(who), 'alliance', J1, { locked: false })).rejects.toMatchObject({
        code: 'forbidden',
        message: expect.stringMatching(/manager of Corp A/),
      });
    expect(writes).toEqual([]);
    expect(calls.setLocal).toEqual([]);
  });

  it('unlocks at the source for its manager, recorded as made via the composite', async () => {
    const { chain, writes, calls } = setup();
    await chain.updateSystem(person('alice'), 'alliance', J1, { locked: false });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      mapId: 'corp-a',
      command: { op: 'system.update', key: String(J1), fields: { locked: false } },
      context: { actor: { id: 'alice' }, via: { mapId: 'alliance', name: 'Alliance chain' } },
    });
    expect(calls.setLocal).toEqual([]);
  });

  it('lifts the composite’s own lock first, with this map’s managers, and never writes it to sources', async () => {
    const { chain, writes, calls } = setup({ localLock: true });
    await expect(chain.updateSystem(person('dave'), 'alliance', J1, { locked: false })).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
    await chain.updateSystem(person('carol'), 'alliance', J1, { locked: false });
    expect(calls.setLocal).toEqual([{ locked: false }]);
    expect(writes).toEqual([]);
  });

  it('keeps notes cleared on a composite cleared, its own empty notes covering the sources’', async () => {
    const { chain, writes, calls } = setup({ sourceLock: false });
    await chain.updateSystem(person('dave'), 'alliance', J1, { description: '' });
    expect(calls.setLocal).toEqual([{ notes: '' }]);
    expect(writes).toEqual([]);
  });

  it('keeps a composite’s new lock its own, other fields still going to the sources', async () => {
    const { chain, writes, calls } = setup({ sourceLock: false });
    await chain.updateSystem(person('carol'), 'alliance', J1, { locked: true });
    expect(calls.setLocal).toEqual([{ locked: true }]);
    expect(writes).toEqual([]);
  });
});
