import { beforeEach, expect, it } from 'vitest';
import { mapStream, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  BookmarkNumberUseCases,
  ConnectionUseCases,
  MapUseCases,
  SystemUseCases,
  type ChainMap,
  type Connection,
} from '@darkbeacon/mapping';
import type { ConnectionDto } from '@darkbeacon/shared';
import { account, mappingTestPorts, SYSTEMS } from './testing.js';

const alice = account('alice');
const bob = account('bob');
const viewer = account('vera');

const { jita, perimeter, c1, c2, c5, shattered } = SYSTEMS;

describeEachDialect('bookmark numbers', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let maps: MapUseCases;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  let numbers: BookmarkNumberUseCases;
  let map: ChainMap;

  const eventsSince = async (seq: number) =>
    (await env.ports.events.readSince(mapStream(map.id), seq)).map(
      (e: DomainEvent) => [e.type, e.data as ConnectionDto] as const,
    );
  const head = () => env.ports.events.headSeq(mapStream(map.id));
  /** `{n}` of every connection by its far end, as stored. */
  const numbering = async () =>
    Object.fromEntries(
      (await env.ports.connections.list(map.id)).map((c) => [
        `${c.source}-${c.target}`,
        c.bookmarkNumber === null ? null : `${c.bookmarkParent}#${c.bookmarkNumber}`,
      ]),
    );
  const connect = async (source: number, target: number) => {
    env.clock.advance(1000);
    return connections.add(bob, map.id, { source, target });
  };

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    maps = new MapUseCases(env.ports);
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    numbers = new BookmarkNumberUseCases(env.ports);
    map = await maps.create(alice, { name: 'Chain' });
    env.access.grant('bob', map.id, 'member');
    env.access.grant('vera', map.id, 'viewer');
    for (const id of [c2, c1, shattered, c5, jita, perimeter]) {
      env.clock.advance(10);
      await systems.add(bob, map.id, { solarSystemId: id });
    }
    await systems.update(bob, map.id, c2, { status: 'home' });
  });

  it('numbers new wormholes out of a system and publishes them numbered, once', async () => {
    const seq = await head();
    const a = await connect(c2, c1);
    const b = await connect(shattered, c2);
    expect(a).toMatchObject({ bookmarkNumber: 1, bookmarkParent: c2 });
    // Drawn towards home, still counted out of home.
    expect(b).toMatchObject({ bookmarkNumber: 2, bookmarkParent: c2 });
    expect(await eventsSince(seq)).toEqual([
      ['connection.added', a],
      ['connection.added', b],
    ]);
    expect(await env.ports.connections.findById(map.id, a.id)).toEqual(a);

    // Stargates are not numbered, and the next system counts on its own.
    await connect(c1, jita);
    const gate = await connect(jita, perimeter);
    expect(gate).toMatchObject({ type: 'gate', bookmarkNumber: null, bookmarkParent: null });
    expect(await numbering()).toEqual({
      [`${c2}-${c1}`]: `${c2}#1`,
      [`${shattered}-${c2}`]: `${c2}#2`,
      [`${c1}-${jita}`]: `${c1}#1`,
      [`${jita}-${perimeter}`]: null,
    });
  });

  it('keeps numbers when a wormhole closes; the next new one takes the gap', async () => {
    await connect(c2, c1);
    const middle = await connect(c2, shattered);
    await connect(c2, c5);
    const seq = await head();
    await connections.remove(bob, map.id, middle.id);
    expect((await eventsSince(seq)).map(([type]) => type)).toEqual(['connection.removed']);
    expect(await numbering()).toEqual({ [`${c2}-${c1}`]: `${c2}#1`, [`${c2}-${c5}`]: `${c2}#3` });

    await connect(c2, jita);
    expect(await numbering()).toMatchObject({ [`${c2}-${jita}`]: `${c2}#2` });

    // Hiding a system closes its wormholes the same way.
    await systems.remove(bob, map.id, c1);
    expect(await numbering()).toEqual({ [`${c2}-${c5}`]: `${c2}#3`, [`${c2}-${jita}`]: `${c2}#2` });
  });

  it('applies the map numbering: a new order renumbers, renumber on close closes gaps', async () => {
    const one = await connect(c2, c5);
    const two = await connect(c2, shattered);
    const three = await connect(c2, c1);
    await expect(
      maps.setBookmarkNumbering(bob, map.id, { order: 'class', renumberOnClose: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const seq = await head();
    const updated = await maps.setBookmarkNumbering(alice, map.id, {
      order: 'class',
      renumberOnClose: false,
    });
    expect(updated.settings.bookmarkNumbering).toEqual({ order: 'class', renumberOnClose: false });
    // C1, C5, then the shattered C13.
    expect(await numbering()).toEqual({
      [`${c2}-${c5}`]: `${c2}#2`,
      [`${c2}-${shattered}`]: `${c2}#3`,
      [`${c2}-${c1}`]: `${c2}#1`,
    });
    const changes = await eventsSince(seq);
    expect(changes.map(([type, data]) => [type, data.id])).toEqual([
      ['map.settings_changed', map.id],
      ['connection.updated', one.id],
      ['connection.updated', two.id],
      ['connection.updated', three.id],
    ]);

    await maps.setBookmarkNumbering(alice, map.id, { order: 'class', renumberOnClose: true });
    await connections.remove(bob, map.id, three.id);
    expect(await numbering()).toEqual({
      [`${c2}-${c5}`]: `${c2}#1`,
      [`${c2}-${shattered}`]: `${c2}#2`,
    });

    // Back to the defaults: found order, the numbers as they are.
    await maps.setBookmarkNumbering(alice, map.id, null);
    expect((await maps.get(alice, map.id)).settings.bookmarkNumbering).toBeUndefined();
  });

  it('moves numbers by hand and renumbers on request', async () => {
    const a = await connect(c2, c1);
    const b = await connect(c2, shattered);
    const c = await connect(c2, c5);
    await connections.remove(bob, map.id, b.id);

    await expect(numbers.setNumber(viewer, map.id, c.id, 1)).rejects.toMatchObject({ code: 'forbidden' });
    const seq = await head();
    const moved = await numbers.setNumber(bob, map.id, c.id, 1);
    expect(moved).toMatchObject({ bookmarkNumber: 1 });
    expect(await numbering()).toEqual({ [`${c2}-${c1}`]: `${c2}#3`, [`${c2}-${c5}`]: `${c2}#1` });
    expect((await eventsSince(seq)).map(([type, data]) => [type, data.id, data.bookmarkNumber])).toEqual([
      ['connection.updated', a.id, 3],
      ['connection.updated', c.id, 1],
    ]);
    await expect(numbers.setNumber(bob, map.id, c.id, 4)).rejects.toMatchObject({ code: 'validation' });

    await numbers.renumber(bob, map.id, c2);
    // Found order: c1's hole was first.
    expect(await numbering()).toEqual({ [`${c2}-${c1}`]: `${c2}#1`, [`${c2}-${c5}`]: `${c2}#2` });

    // By hand, a renumber keeps the order the numbers are in.
    await numbers.setNumber(bob, map.id, c.id, 1);
    await maps.setBookmarkNumbering(alice, map.id, { order: 'manual', renumberOnClose: false });
    await numbers.renumber(bob, map.id);
    expect(await numbering()).toEqual({ [`${c2}-${c1}`]: `${c2}#2`, [`${c2}-${c5}`]: `${c2}#1` });

    const gate = await connect(jita, perimeter);
    await expect(numbers.setNumber(bob, map.id, gate.id, 1)).rejects.toMatchObject({ code: 'validation' });
  });

  it('counts out of the new parent when the chain turns around a new home', async () => {
    await connect(c2, c1);
    await connect(c1, c5);
    await connect(c1, shattered);
    expect(await numbering()).toEqual({
      [`${c2}-${c1}`]: `${c2}#1`,
      [`${c1}-${c5}`]: `${c1}#1`,
      [`${c1}-${shattered}`]: `${c1}#2`,
    });
    await systems.update(bob, map.id, c2, { status: 'unknown' });
    await systems.update(bob, map.id, c5, { status: 'home' });
    // From c5: c1 is one out of c5; c2 and the shattered system are out of c1. The shattered
    // hole still leads out of c1 and keeps its number; c2's takes the free one.
    expect(await numbering()).toEqual({
      [`${c2}-${c1}`]: `${c1}#1`,
      [`${c1}-${c5}`]: `${c5}#1`,
      [`${c1}-${shattered}`]: `${c1}#2`,
    });
  });

  it('numbers wormholes mapped before numbering existed, once', async () => {
    await connect(c2, c1);
    const old: Connection[] = [];
    for (const [source, target] of [
      [c2, c5],
      [c2, shattered],
    ] as const) {
      env.clock.advance(1000);
      const now = env.clock.now();
      const connection: Connection = {
        id: `old-${target}`,
        mapId: map.id,
        source,
        target,
        type: 'wormhole',
        timeStatus: 'normal',
        massStatus: 'fresh',
        shipSize: 'large',
        massSaved: false,
        dangerous: false,
        bubbled: 'none',
        eolAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await env.ports.connections.insert(connection);
      old.push(connection);
    }
    expect(await numbering()).toMatchObject({ [`${c2}-${c5}`]: null, [`${c2}-${shattered}`]: null });

    const seq = await head();
    expect(await numbers.backfill()).toEqual([map.id]);
    expect(await numbering()).toEqual({
      [`${c2}-${c1}`]: `${c2}#1`,
      [`${c2}-${c5}`]: `${c2}#2`,
      [`${c2}-${shattered}`]: `${c2}#3`,
    });
    const events = await env.ports.events.readSince(mapStream(map.id), seq);
    expect(events.map((e) => [e.type, e.actor])).toEqual([
      ['connection.updated', { kind: 'system', id: 'bookmark-numbers' }],
      ['connection.updated', { kind: 'system', id: 'bookmark-numbers' }],
    ]);
    expect(await numbers.backfill()).toEqual([]);
  });
});
