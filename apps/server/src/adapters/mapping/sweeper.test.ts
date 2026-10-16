import { beforeEach, expect, it } from 'vitest';
import { mapStream } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ChainSweeper,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type ChainMap,
  type SweepSettings,
} from '@darkbeacon/mapping';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { account, mappingTestPorts } from './testing.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOME = 31002531; // J014348, C3
const C2 = 31000399; // J130256, C2
const TAMA = 30002813; // low-sec
const JITA = 30000142;
const PERIMETER = 30000144;
const AMARR = 30002187;

const alice = account('alice');
const ON: SweepSettings = { expiredConnectionMinutes: 0, autoEol: true, staleSystemMinutes: 15 };

describeEachDialect('sweeper', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  let sweeper: ChainSweeper;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.universe = StaticUniverseCatalog.load('/nonexistent');
    env.clock.set(1_000_000_000);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    systems = new SystemUseCases(env.ports);
    for (const id of [HOME, C2, TAMA, JITA, PERIMETER])
      await systems.add(alice, map.id, { solarSystemId: id });
    connections = new ConnectionUseCases(env.ports);
    sweeper = new ChainSweeper(env.ports);
  });

  const events = async (type: string) =>
    (await env.ports.events.readSince(mapStream(map.id), 0)).filter((e) => e.type === type);

  it('marks a hole EOL when its last 4 hours begin and deletes it once it cannot exist', async () => {
    const typed = await connections.add(alice, map.id, { source: HOME, target: TAMA });
    const signatures = new SignatureUseCases(env.ports);
    const sig = await signatures.add(alice, map.id, HOME, { eveId: 'UUU-210' });
    await signatures.update(alice, map.id, sig.id, { type: 'U210', connectionId: typed.id }); // 24 h
    const untyped = await connections.add(alice, map.id, { source: HOME, target: C2 }); // C2-C3: 16 h by class
    const gate = await connections.add(alice, map.id, { source: JITA, target: PERIMETER });
    const seen = env.clock.now();

    env.clock.set(seen + 11.9 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toEqual({ eol: 0, deleted: 0, hidden: 0, signatures: 0 });
    env.clock.set(seen + 12 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ eol: 1 });
    const eol = await env.ports.connections.findById(map.id, untyped.id);
    expect(eol).toMatchObject({ timeStatus: 'eol', eolAt: seen + 12 * HOUR });
    const updated = (await events('connection.updated')).at(-1)!;
    expect(updated.actor).toEqual({ kind: 'system', id: 'sweeper' });
    expect(updated.data).toMatchObject({ id: untyped.id, timeStatus: 'eol' });

    env.clock.set(seen + 16 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ deleted: 1 });
    expect(await env.ports.connections.findById(map.id, untyped.id)).toBeNull();
    expect((await events('connection.removed')).map((e) => e.data)).toEqual([{ id: untyped.id }]);
    // A deliberate removal: maps that merge this one drop older copies too.
    expect((await env.ports.stamps.tombstones(map.id, 'connection')).size).toBe(1);

    env.clock.set(seen + 20 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ eol: 1, deleted: 0 });
    env.clock.set(seen + 24 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ deleted: 1 });
    // Stargates never expire.
    expect(await env.ports.connections.findById(map.id, gate.id)).not.toBeNull();
  });

  it('dates a hole from its sightings, not from a signature entry older than the hole can be', async () => {
    const signatures = new SignatureUseCases(env.ports);
    // The entry is from a day ago (a Wanderer sync keeps its first insert); the hole on it is new.
    const sig = await signatures.add(alice, map.id, HOME, { eveId: 'UUU-210' });
    const drawn = env.clock.now() + 25 * HOUR;
    env.clock.set(drawn);
    const hole = await connections.add(alice, map.id, { source: HOME, target: TAMA });
    await signatures.update(alice, map.id, sig.id, { type: 'U210', connectionId: hole.id }); // 24 h

    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ eol: 0, deleted: 0 });
    expect(await env.ports.connections.findById(map.id, hole.id)).not.toBeNull();
    env.clock.set(drawn + 20 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ eol: 1, deleted: 0 });
    env.clock.set(drawn + 24 * HOUR);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ deleted: 1 });
  });

  it('deletes a hole marked EOL 4 hours later, plus the configured delay, and can be switched off', async () => {
    const c = await connections.add(alice, map.id, { source: HOME, target: C2 });
    await connections.update(alice, map.id, c.id, { timeStatus: 'eol' });
    const marked = env.clock.now();
    env.clock.set(marked + 4 * HOUR);
    expect(await sweeper.sweep(map.id, { ...ON, expiredConnectionMinutes: 30 })).toMatchObject({
      deleted: 0,
    });
    expect(await sweeper.sweep(map.id, { ...ON, expiredConnectionMinutes: null })).toMatchObject({
      deleted: 0,
    });
    env.clock.set(marked + 4 * HOUR + 30 * MINUTE);
    expect(await sweeper.sweep(map.id, { ...ON, expiredConnectionMinutes: 30 })).toMatchObject({
      deleted: 1,
    });
  });

  it('leaves auto-EOL to people when it is off', async () => {
    const c = await connections.add(alice, map.id, { source: HOME, target: C2 });
    env.clock.advance(13 * HOUR);
    await sweeper.sweep(map.id, { ...ON, autoEol: false });
    expect((await env.ports.connections.findById(map.id, c.id))?.timeStatus).toBe('normal');
  });

  it('hides systems left alone, unless locked, home, connected or with a pilot in them', async () => {
    await connections.add(alice, map.id, { source: JITA, target: PERIMETER });
    await systems.add(alice, map.id, { solarSystemId: AMARR });
    await systems.update(alice, map.id, TAMA, { locked: true });
    await systems.update(alice, map.id, HOME, { status: 'home' });
    env.clock.advance(14 * MINUTE);
    expect(await sweeper.sweep(map.id, ON)).toMatchObject({ hidden: 0 });
    env.clock.advance(2 * MINUTE);
    const occupancy = { occupied: async () => new Set([C2]) };
    expect(await sweeper.sweep(map.id, ON, occupancy)).toMatchObject({ hidden: 1 });
    const visible = (await env.ports.systems.list(map.id))
      .filter((s) => s.visible)
      .map((s) => s.solarSystemId);
    expect(visible.sort()).toEqual([HOME, C2, TAMA, JITA, PERIMETER].sort());
    expect((await events('system.removed')).map((e) => e.data)).toEqual([{ solarSystemId: AMARR }]);
    expect(await sweeper.sweep(map.id, { ...ON, staleSystemMinutes: null })).toMatchObject({ hidden: 0 });
  });

  it('has nothing to sweep on a composite', async () => {
    const composite = await new MapUseCases(env.ports).create(alice, { name: 'All', kind: 'composite' });
    expect(await sweeper.sweep(composite.id, ON)).toEqual({ eol: 0, deleted: 0, hidden: 0, signatures: 0 });
  });

  it('lazily deletes signatures a day after they were last pasted or changed, as itself, keeping linked holes and custom entries', async () => {
    const OFF: SweepSettings = { expiredConnectionMinutes: null, autoEol: false, staleSystemMinutes: null };
    const signatures = new SignatureUseCases(env.ports);
    const hole = await connections.add(alice, map.id, { source: HOME, target: C2 });
    const site = await signatures.add(alice, map.id, HOME, { eveId: 'GOM-778', group: 'gas' });
    const linked = await signatures.add(alice, map.id, HOME, { eveId: 'DKM-763' });
    await signatures.update(alice, map.id, linked.id, { connectionId: hole.id });
    await signatures.add(alice, map.id, HOME, { eveId: 'Tower at P3', custom: true });
    await signatures.add(alice, map.id, TAMA, { eveId: 'KCH-395', group: 'gas' });
    await systems.remove(alice, map.id, TAMA);
    const added = env.clock.now();
    const paste = {
      text: 'GOM-778\tCosmic Signature\tGas Site\tSizeable Perimeter Reservoir\t100.0%\t4.2 AU',
      mode: 'merge' as const,
    };

    // A paste an hour later names the site: changed, so its day starts again.
    env.clock.set(added + HOUR);
    await signatures.paste(alice, map.id, HOME, paste);
    const fresh = await signatures.add(alice, map.id, HOME, { eveId: 'NEW-001' });

    env.clock.set(added + 23.9 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 0 });
    env.clock.set(added + 24 * HOUR);
    // The hidden system's signature, idle for a day; the rest was pasted or added since.
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 1 });

    // A paste that still lists the site, unchanged, keeps it alive.
    env.clock.set(added + 24.5 * HOUR);
    await signatures.paste(alice, map.id, HOME, paste);
    env.clock.set(added + 25 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 1 });
    expect(await env.ports.signatures.findById(map.id, fresh.id)).toBeNull();
    env.clock.set(added + 48.4 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 0 });
    env.clock.set(added + 48.5 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 1 });
    const left = (await env.ports.signatures.listForMap(map.id)).map((s) => s.eveId).sort();
    expect(left).toEqual(['DKM-763', 'Tower at P3']);
    const removed = await events('signature.removed');
    // The hidden system's goes quietly.
    expect(removed.map((e) => e.data)).toEqual([
      { id: fresh.id, solarSystemId: HOME },
      { id: site.id, solarSystemId: HOME },
    ]);
    expect(removed[0]!.actor).toEqual({ kind: 'system', id: 'sweeper' });
    // Expiries, counted from when each was last seen: a sync whose source saw one later brings it back.
    const tombstones = await env.ports.stamps.signatureTombstones(map.id);
    expect(Object.fromEntries(tombstones)).toEqual({
      [`${TAMA}:KCH-395`]: { deletedAt: added + 24 * HOUR, expiredFrom: added },
      [`${HOME}:NEW-001`]: { deletedAt: added + 25 * HOUR, expiredFrom: added + HOUR },
      [`${HOME}:GOM-778`]: { deletedAt: added + 48.5 * HOUR, expiredFrom: added + 24.5 * HOUR },
    });

    // Once its connection is gone, the hole is a signature like the others: unlinked (a change)
    // now, it goes a day later.
    await connections.remove(alice, map.id, hole.id);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 0 });
    env.clock.set(added + 72.5 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 1 });
    expect(await env.ports.signatures.findById(map.id, linked.id)).toBeNull();

    // A map that switched it off keeps them.
    const late = await signatures.add(alice, map.id, HOME, { eveId: 'LAT-001' });
    await new MapUseCases(env.ports).update(alice, map.id, { settings: { signatureLazyDelete: false } });
    env.clock.set(added + 96 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 0 });
    expect(await env.ports.signatures.findById(map.id, late.id)).not.toBeNull();
  });

  it('a deletion on purpose replaces an expiry of the same signature', async () => {
    const signatures = new SignatureUseCases(env.ports);
    const OFF: SweepSettings = { expiredConnectionMinutes: null, autoEol: false, staleSystemMinutes: null };
    await signatures.add(alice, map.id, HOME, { eveId: 'GOM-778' });
    const added = env.clock.now();
    env.clock.set(added + 25 * HOUR);
    expect(await sweeper.sweep(map.id, OFF)).toMatchObject({ signatures: 1 });
    expect((await env.ports.stamps.signatureTombstones(map.id)).get(`${HOME}:GOM-778`)).toEqual({
      deletedAt: added + 25 * HOUR,
      expiredFrom: added,
    });
    // Pasted again, then deleted by someone: that deletion holds.
    const again = await signatures.add(alice, map.id, HOME, { eveId: 'GOM-778' });
    await signatures.remove(alice, map.id, again.id);
    expect((await env.ports.stamps.signatureTombstones(map.id)).get(`${HOME}:GOM-778`)).toEqual({
      deletedAt: added + 25 * HOUR,
    });
  });
});
