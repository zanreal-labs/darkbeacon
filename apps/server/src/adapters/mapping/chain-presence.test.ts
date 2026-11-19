import { beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ChainPresenceUseCases,
  ConnectionUseCases,
  MapUseCases,
  SystemUseCases,
  type ChainMap,
} from '@darkbeacon/mapping';
import { account, mappingTestPorts, SYSTEMS } from './testing.js';

const HOME = SYSTEMS.c2;
const HOLE = SYSTEMS.c5;
const NEXT = SYSTEMS.c1;
const HOUR = 60 * 60 * 1000;
const alice = account('alice');
const bob = account('bob');

describeEachDialect('chain presence', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  let presence: ChainPresenceUseCases;
  const start = 1_000_000_000;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.clock.set(start);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    presence = new ChainPresenceUseCases(env.ports);
    for (const id of [HOME, HOLE, NEXT]) await systems.add(alice, map.id, { solarSystemId: id });
    await systems.update(alice, map.id, HOME, { status: 'home' });
  });

  const rows = async () =>
    Object.fromEntries((await presence.list(alice, map.id)).systems.map((s) => [s.solarSystemId, s]));

  it('keeps when each system joined and left the chain from home', async () => {
    await presence.record(map.id);
    expect(await rows()).toEqual({ [HOME]: { solarSystemId: HOME, joinedAt: start, leftAt: null } });

    env.clock.set(start + HOUR);
    const hole = await connections.add(alice, map.id, { source: HOME, target: HOLE });
    await connections.add(alice, map.id, { source: HOLE, target: NEXT });
    expect(await presence.record(map.id)).toBe(2);
    // Recording an unchanged chain writes nothing.
    expect(await presence.record(map.id)).toBe(0);

    env.clock.set(start + 3 * HOUR);
    await connections.remove(alice, map.id, hole.id);
    await presence.record(map.id);
    expect(await rows()).toEqual({
      [HOME]: { solarSystemId: HOME, joinedAt: start, leftAt: null },
      [HOLE]: { solarSystemId: HOLE, joinedAt: start + HOUR, leftAt: start + 3 * HOUR },
      [NEXT]: { solarSystemId: NEXT, joinedAt: start + HOUR, leftAt: start + 3 * HOUR },
    });
    expect((await presence.list(alice, map.id)).recordedSince).toBe(start);

    // Found again later from the other side: both in the chain again since then.
    env.clock.set(start + 50 * HOUR);
    await connections.add(alice, map.id, { source: HOME, target: NEXT });
    await presence.record(map.id);
    expect((await rows())[NEXT]).toEqual({ solarSystemId: NEXT, joinedAt: start + 50 * HOUR, leftAt: null });
    expect((await rows())[HOLE]).toEqual({ solarSystemId: HOLE, joinedAt: start + 50 * HOUR, leftAt: null });
  });

  it('counts the moment a system is taken off the map as its last in the chain', async () => {
    await connections.add(alice, map.id, { source: HOME, target: HOLE });
    await presence.record(map.id);
    env.clock.set(start + 2 * HOUR);
    await systems.remove(alice, map.id, HOLE);
    await presence.record(map.id);
    expect((await rows())[HOLE]).toMatchObject({ joinedAt: start, leftAt: start + 2 * HOUR });
  });

  it('walks the chain again only after changes that may move it', async () => {
    await presence.record(map.id);
    const hole = (await env.ports.systems.find(map.id, HOLE))!;
    const home = (await env.ports.systems.find(map.id, HOME))!;
    expect(presence.moves(map.id, 'system.updated', { ...hole, description: 'gas' })).toBe(false);
    expect(presence.moves(map.id, 'system.updated', { ...hole, status: 'home' })).toBe(true);
    expect(presence.moves(map.id, 'system.updated', { ...home, status: 'friendly' })).toBe(true);
    expect(presence.moves(map.id, 'connection.removed', { id: 'x' })).toBe(true);
    // A map not recorded in this process yet is walked.
    expect(presence.moves('other', 'system.updated', { ...hole, description: 'gas' })).toBe(true);
  });

  it('fills the record of a map from its history once, then keeps it up to date', async () => {
    env.clock.set(start + HOUR);
    const hole = await connections.add(alice, map.id, { source: HOME, target: HOLE });
    env.clock.set(start + 5 * HOUR);
    await connections.remove(alice, map.id, hole.id);
    env.clock.set(start + 6 * HOUR);
    await connections.add(alice, map.id, { source: HOME, target: NEXT });

    env.clock.set(start + 10 * HOUR);
    expect(await presence.backfillAll()).toEqual([map.id]);
    expect(await rows()).toEqual({
      [HOME]: { solarSystemId: HOME, joinedAt: start, leftAt: null },
      [HOLE]: { solarSystemId: HOLE, joinedAt: start + HOUR, leftAt: start + 5 * HOUR },
      [NEXT]: { solarSystemId: NEXT, joinedAt: start + 6 * HOUR, leftAt: null },
    });

    // The next start only brings it up to date.
    await systems.update(alice, map.id, HOME, { status: 'friendly' });
    expect(await presence.backfill(map.id)).toBe('kept');
    // Without a home the chain grows from the oldest system, which is still the old home.
    expect((await rows())[NEXT]!.leftAt).toBeNull();
  });

  it('answers only those who may see the map', async () => {
    await expect(presence.list(bob, map.id)).rejects.toMatchObject({ code: 'not_found' });
    env.access.grant(bob.id, map.id, 'viewer');
    expect((await presence.list(bob, map.id)).recordedSince).toBeNull();
  });
});
