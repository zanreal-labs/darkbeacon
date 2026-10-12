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
    expect(await sweeper.sweep(map.id, ON)).toEqual({ eol: 0, deleted: 0, hidden: 0 });
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
    expect(await sweeper.sweep(composite.id, ON)).toEqual({ eol: 0, deleted: 0, hidden: 0 });
  });
});
