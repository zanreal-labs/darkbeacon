import { beforeEach, expect, it } from 'vitest';
import { mapStream, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ConnectionUseCases,
  MapSnapshotQuery,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type ChainMap,
} from '@darkbeacon/mapping';
import { account, mappingTestPorts, SYSTEMS } from './testing.js';

const alice = account('alice');
const bob = account('bob');
const eve = account('eve');

const PASTE = [
  'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.32 AU',
  'DEF-456\tCosmic Signature\t\t\t0.0%\t12.10 AU',
].join('\n');

describeEachDialect('mapping use cases', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let maps: MapUseCases;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  let signatures: SignatureUseCases;
  let snapshots: MapSnapshotQuery;
  let map: ChainMap;

  /** Events of the map stream after `seq`, as [type, data] pairs. */
  const eventsSince = async (seq: number) =>
    (await env.ports.events.readSince(mapStream(map.id), seq)).map((e: DomainEvent) => [e.type, e.data]);
  const head = () => env.ports.events.headSeq(mapStream(map.id));

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    maps = new MapUseCases(env.ports);
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    signatures = new SignatureUseCases(env.ports);
    snapshots = new MapSnapshotQuery(env.ports);
    map = await maps.create(alice, { name: 'Home Chain' });
    env.access.grant('bob', map.id, 'member');
  });

  it('creates maps with free slugs and lists what the actor can see', async () => {
    expect(map).toMatchObject({
      slug: 'home-chain',
      ownerAccountId: 'alice',
      settings: { scopes: ['wormhole'] },
    });
    expect(await eventsSince(0)).toEqual([['map.created', map]]);

    const second = await maps.create(bob, { name: 'HOME CHAIN' });
    expect(second.slug).toBe('home-chain-2');
    await expect(maps.create(bob, { name: 'x', slug: 'home-chain' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(maps.create(null, { name: 'x' })).rejects.toMatchObject({ code: 'unauthenticated' });

    expect(await maps.list(alice)).toEqual([
      { id: map.id, slug: 'home-chain', name: 'Home Chain', role: 'admin' },
    ]);
    expect((await maps.list(bob)).map((m) => [m.slug, m.role]).sort()).toEqual([
      ['home-chain', 'member'],
      ['home-chain-2', 'admin'],
    ]);
    expect(await maps.list(eve)).toEqual([]);
    expect(await maps.getBySlug(bob, 'home-chain')).toEqual(map);
    await expect(maps.getBySlug(eve, 'home-chain')).rejects.toMatchObject({ code: 'not_found' });
    await expect(maps.get(eve, map.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('changes settings (admin) and labels (manager+)', async () => {
    await expect(maps.update(bob, map.id, { name: 'Nope' })).rejects.toMatchObject({ code: 'forbidden' });
    env.clock.advance(1000);
    const updated = await maps.update(alice, map.id, {
      name: 'Renamed',
      settings: { scopes: ['wormhole', 'low', 'low'] },
    });
    expect(updated).toMatchObject({
      name: 'Renamed',
      slug: 'home-chain',
      settings: { scopes: ['wormhole', 'low'] },
    });
    expect(updated.updatedAt).toBe(map.updatedAt + 1000);
    // No change, no event.
    await maps.update(alice, map.id, { name: 'Renamed' });
    expect(await eventsSince(1)).toEqual([['map.settings_changed', updated]]);

    const labels = [
      { id: 'l1', name: 'Static', color: '#ff0000', description: 'Our static' },
      { id: 'l2', name: 'Farm', color: '#00ff00', description: '' },
    ];
    await expect(maps.setLabels(bob, map.id, labels)).rejects.toMatchObject({ code: 'forbidden' });
    env.access.grant('bob', map.id, 'manager');
    expect(await maps.setLabels(bob, map.id, labels)).toEqual(labels);
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    await systems.update(bob, map.id, SYSTEMS.c2, { labelIds: ['l1', 'l2'] });
    await expect(systems.update(bob, map.id, SYSTEMS.c2, { labelIds: ['zz'] })).rejects.toMatchObject({
      code: 'validation',
    });

    const seq = await head();
    await maps.setLabels(bob, map.id, [labels[1]!]);
    expect(await eventsSince(seq)).toEqual([
      ['labels.changed', { labels: [labels[1]] }],
      ['system.updated', expect.objectContaining({ solarSystemId: SYSTEMS.c2, labelIds: ['l2'] })],
    ]);
    expect((await maps.get(bob, map.id)).labels).toEqual([labels[1]]);
  });

  it('adds, updates, locks and moves systems', async () => {
    await expect(systems.add(eve, map.id, { solarSystemId: SYSTEMS.c2 })).rejects.toMatchObject({
      code: 'not_found',
    });
    env.access.grant('eve', map.id, 'viewer');
    await expect(systems.add(eve, map.id, { solarSystemId: SYSTEMS.c2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(systems.add(bob, map.id, { solarSystemId: 1 })).rejects.toMatchObject({ code: 'not_found' });

    const seq = await head();
    const a = await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2, position: { x: 10, y: 20 } });
    const b = await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c5 });
    expect(b.position).toEqual({ x: 370, y: 20 });
    // Adding again is a no-op.
    expect(await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 })).toEqual(a);
    expect(await eventsSince(seq)).toEqual([
      ['system.added', a],
      ['system.added', b],
    ]);

    const named = await systems.update(bob, map.id, SYSTEMS.c2, {
      customName: 'Home',
      status: 'home',
      description: '**static** to C5',
      locked: true,
    });
    expect(named).toMatchObject({ customName: 'Home', status: 'home', locked: true });
    await expect(systems.update(bob, map.id, SYSTEMS.c2, { position: { x: 0, y: 0 } })).rejects.toMatchObject(
      { code: 'conflict' },
    );
    await expect(systems.remove(bob, map.id, SYSTEMS.c2)).rejects.toMatchObject({ code: 'conflict' });

    // A batch move is all or nothing: the locked system rolls back the whole request.
    const before = await head();
    await expect(
      systems.move(bob, map.id, {
        positions: [
          { solarSystemId: SYSTEMS.c5, x: 500, y: 500 },
          { solarSystemId: SYSTEMS.c2, x: 1, y: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await head()).toBe(before);
    expect((await env.ports.systems.find(map.id, SYSTEMS.c5))?.position).toEqual(b.position);

    // Unlocking and moving in one request works.
    const moved = await systems.update(bob, map.id, SYSTEMS.c2, { locked: false, position: { x: 1, y: 1 } });
    expect(moved).toMatchObject({ locked: false, position: { x: 1, y: 1 } });
    await systems.move(bob, map.id, { positions: [{ solarSystemId: SYSTEMS.c5, x: 500, y: 500 }] });
    expect(await eventsSince(before)).toEqual([
      ['system.updated', moved],
      [
        'system.updated',
        expect.objectContaining({ solarSystemId: SYSTEMS.c5, position: { x: 500, y: 500 } }),
      ],
    ]);
  });

  it('hides a removed system, keeps its intel and restores it', async () => {
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c5 });
    await systems.update(bob, map.id, SYSTEMS.c5, { customName: 'Farm', description: 'notes' });
    const link = await connections.add(bob, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 });
    const here = await signatures.add(bob, map.id, SYSTEMS.c5, { eveId: 'ABC-123' });
    const there = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'XYZ-987' });
    await signatures.update(bob, map.id, here.id, { connectionId: link.id });
    await signatures.update(bob, map.id, there.id, { connectionId: link.id });

    const seq = await head();
    await systems.remove(bob, map.id, SYSTEMS.c5);
    // Nothing is published about the hidden system's own signature.
    expect(await eventsSince(seq)).toEqual([
      ['signature.updated', expect.objectContaining({ id: there.id, connectionId: null })],
      ['connection.removed', { id: link.id }],
      ['system.removed', { solarSystemId: SYSTEMS.c5 }],
    ]);

    const snapshot = await snapshots.snapshot(bob, map.id);
    expect(snapshot.systems.map((s) => s.solarSystemId)).toEqual([SYSTEMS.c2]);
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.signatures.map((s) => s.eveId)).toEqual(['XYZ-987']);

    // Hidden systems are unreachable for commands.
    await expect(systems.update(bob, map.id, SYSTEMS.c5, { tag: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(signatures.list(bob, map.id, SYSTEMS.c5)).rejects.toMatchObject({ code: 'not_found' });
    await expect(signatures.add(bob, map.id, SYSTEMS.c5, { eveId: 'QQQ-111' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(signatures.update(bob, map.id, here.id, { name: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      connections.add(bob, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(systems.remove(bob, map.id, SYSTEMS.c5)).rejects.toMatchObject({ code: 'not_found' });

    const restoredAt = await head();
    const restored = await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c5, position: { x: 7, y: 8 } });
    expect(restored).toMatchObject({
      customName: 'Farm',
      description: 'notes',
      visible: true,
      position: { x: 7, y: 8 },
    });
    expect(await eventsSince(restoredAt)).toEqual([
      ['system.added', restored],
      ['signature.added', expect.objectContaining({ id: here.id, eveId: 'ABC-123', connectionId: null })],
    ]);

    // Hiding through an update works the same way, and so does restoring.
    await systems.update(bob, map.id, SYSTEMS.c5, { visible: false });
    expect((await snapshots.snapshot(bob, map.id)).systems).toHaveLength(1);
    const back = await systems.update(bob, map.id, SYSTEMS.c5, { visible: true, tag: 'B' });
    expect(back).toMatchObject({ visible: true, tag: 'B', customName: 'Farm' });
  });

  it('adds, updates and removes connections', async () => {
    for (const id of [SYSTEMS.jita, SYSTEMS.perimeter, SYSTEMS.c1, SYSTEMS.c2]) {
      await systems.add(bob, map.id, { solarSystemId: id });
    }
    const gate = await connections.add(bob, map.id, { source: SYSTEMS.jita, target: SYSTEMS.perimeter });
    expect(gate).toMatchObject({ type: 'gate', shipSize: 'capital' });
    const hole = await connections.add(bob, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c1 });
    expect(hole).toMatchObject({
      type: 'wormhole',
      shipSize: 'medium',
      timeStatus: 'normal',
      massStatus: 'fresh',
    });
    expect(await connections.add(bob, map.id, { source: SYSTEMS.c1, target: SYSTEMS.c2 })).toEqual(hole);
    await expect(
      connections.add(bob, map.id, { source: SYSTEMS.c1, target: SYSTEMS.c1 }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      connections.add(bob, map.id, { source: SYSTEMS.c1, target: SYSTEMS.c5 }),
    ).rejects.toMatchObject({ code: 'not_found' });

    env.clock.advance(60_000);
    const eol = await connections.update(bob, map.id, hole.id, {
      timeStatus: 'eol',
      massStatus: 'critical',
      massSaved: true,
      dangerous: true,
      bubbled: 'both',
      shipSize: 'large',
    });
    expect(eol).toMatchObject({
      eolAt: env.clock.now(),
      massStatus: 'critical',
      bubbled: 'both',
      dangerous: true,
    });
    env.clock.advance(1000);
    // Staying EOL keeps the first stamp; going back to normal clears it.
    expect(
      (await connections.update(bob, map.id, hole.id, { timeStatus: 'eol', type: 'bridge' })).eolAt,
    ).toBe(eol.eolAt);
    expect((await connections.update(bob, map.id, hole.id, { timeStatus: 'normal' })).eolAt).toBeNull();

    const sig = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'ABC-123' });
    await expect(signatures.update(bob, map.id, sig.id, { connectionId: gate.id })).rejects.toMatchObject({
      code: 'validation',
    });
    const linked = await signatures.update(bob, map.id, sig.id, { connectionId: hole.id });
    expect(linked).toMatchObject({ connectionId: hole.id, group: 'wormhole' });

    const seq = await head();
    await connections.remove(bob, map.id, hole.id);
    expect(await eventsSince(seq)).toEqual([
      ['signature.updated', expect.objectContaining({ id: sig.id, connectionId: null })],
      ['connection.removed', { id: hole.id }],
    ]);
    await expect(connections.remove(bob, map.id, hole.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await snapshots.snapshot(bob, map.id)).connections).toEqual([gate]);
  });

  it('keeps one connection per pair when adds race', async () => {
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c1 });
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    const seq = await head();
    const added = await Promise.all([
      connections.add(bob, map.id, { source: SYSTEMS.c1, target: SYSTEMS.c2 }),
      connections.add(alice, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c1 }),
      connections.add(bob, map.id, { source: SYSTEMS.c1, target: SYSTEMS.c2 }),
    ]);
    expect(new Set(added.map((c) => c.id)).size).toBe(1);
    expect((await eventsSince(seq)).map(([type]) => type)).toEqual(['connection.added']);
    // The database itself refuses a second row for the pair, in either direction.
    const reversed = { ...added[0]!, id: 'other', source: SYSTEMS.c2, target: SYSTEMS.c1 };
    expect(await env.ports.connections.insert(reversed)).toBe(false);
    expect((await snapshots.snapshot(bob, map.id)).connections).toHaveLength(1);
  });

  it('manages signatures and merges probe scanner pastes', async () => {
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    const manual = await signatures.add(bob, map.id, SYSTEMS.c2, {
      eveId: 'DEF-456',
      group: 'relic',
      name: 'Ruins',
      description: 'keep me',
    });
    await expect(signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'DEF-456' })).rejects.toMatchObject({
      code: 'conflict',
    });
    const stale = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'OLD-000' });

    const seq = await head();
    const merged = await signatures.paste(bob, map.id, SYSTEMS.c2, {
      text: `${PASTE}\nrubbish`,
      mode: 'merge',
    });
    expect(merged).toEqual({ added: 1, updated: 0, removed: 0, skipped: ['rubbish'] });
    const events = await eventsSince(seq);
    expect(events).toEqual([
      ['signature.added', expect.objectContaining({ eveId: 'ABC-123', group: 'wormhole' })],
    ]);

    // The unscanned DEF-456 in the paste does not erase what is known about it.
    expect((await env.ports.signatures.findById(map.id, manual.id))?.group).toBe('relic');

    const replaced = await signatures.paste(bob, map.id, SYSTEMS.c2, {
      text: `${PASTE}\nDEF-456\tCosmic Signature\tGas Site\tBarren Perimeter Reservoir\t100.0%\t1 AU`,
      mode: 'replace',
    });
    expect(replaced).toEqual({
      added: 0,
      updated: 1,
      removed: 1,
      skipped: [],
      removedSignatures: [expect.objectContaining({ id: stale.id, eveId: 'OLD-000' })],
    });
    const list = await signatures.list(bob, map.id, SYSTEMS.c2);
    expect(list.map((s) => [s.eveId, s.group, s.name, s.description])).toEqual([
      ['ABC-123', 'wormhole', null, ''],
      ['DEF-456', 'gas', 'Barren Perimeter Reservoir', 'keep me'],
    ]);
    expect(list.some((s) => s.id === stale.id)).toBe(false);

    // A paste with nothing usable never wipes the list.
    expect(await signatures.paste(bob, map.id, SYSTEMS.c2, { text: 'oops', mode: 'replace' })).toMatchObject({
      removed: 0,
    });

    const renamed = await signatures.update(bob, map.id, manual.id, { eveId: 'DEF-457', type: 'B274' });
    expect(renamed).toMatchObject({ eveId: 'DEF-457', type: 'B274' });
    await expect(signatures.update(bob, map.id, manual.id, { eveId: 'ABC-123' })).rejects.toMatchObject({
      code: 'conflict',
    });
    const before = await head();
    await signatures.remove(bob, map.id, manual.id);
    expect(await eventsSince(before)).toEqual([
      ['signature.removed', { id: manual.id, solarSystemId: SYSTEMS.c2 }],
    ]);
    env.access.grant('eve', map.id, 'viewer');
    expect((await signatures.list(eve, map.id, SYSTEMS.c2)).map((s) => s.eveId)).toEqual(['ABC-123']);
    await expect(signatures.remove(eve, map.id, list[0]!.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('deletes a map with everything on it', async () => {
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c5 });
    await connections.add(bob, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 });
    await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'ABC-123' });
    await expect(maps.remove(bob, map.id)).rejects.toMatchObject({ code: 'forbidden' });

    const seq = await head();
    await maps.remove(alice, map.id);
    expect(await eventsSince(seq)).toEqual([['map.removed', { id: map.id }]]);
    expect(await env.ports.maps.findById(map.id)).toBeNull();
    expect(await env.ports.systems.list(map.id)).toEqual([]);
    expect(await env.ports.connections.list(map.id)).toEqual([]);
    expect(await env.ports.signatures.listForMap(map.id)).toEqual([]);
  });

  it('publishes on the bus only after commit', async () => {
    const published: string[] = [];
    env.bus.subscribe((e) => {
      published.push(e.type);
    });
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    await expect(systems.add(bob, map.id, { solarSystemId: 42 })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(published).toEqual(['system.added']);
  });
});
