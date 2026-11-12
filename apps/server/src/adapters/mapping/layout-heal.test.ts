import { beforeEach, expect, it } from 'vitest';
import { mapStream } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ConnectionUseCases, MapUseCases, SystemUseCases, type ChainMap } from '@darkbeacon/mapping';
import { SYSTEM_PLACEMENT } from '@darkbeacon/shared';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { account, mappingTestPorts } from './testing.js';

const HOME = 31002531;
const C2 = 31000399;
const TAMA = 30002813;
const JITA = 30000142;
const { x: COLUMN, y: ROW } = SYSTEM_PLACEMENT;

const alice = account('alice');

describeEachDialect('a map healing its layout', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  const at = async (id: number) => (await env.ports.systems.find(map.id, id))!.position;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.universe = StaticUniverseCatalog.load('/nonexistent');
    env.clock.set(1_000_000_000);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    await systems.add(alice, map.id, { solarSystemId: HOME, position: { x: 0, y: 0 } });
    await systems.update(alice, map.id, HOME, { status: 'home' });
    await systems.add(alice, map.id, { solarSystemId: C2, near: HOME });
    await connections.add(alice, map.id, { source: HOME, target: C2, type: 'wormhole' });
  });

  /** C2 left far below home, the way an old layout or another tool stored it. */
  const strand = async () => {
    const c2 = (await env.ports.systems.find(map.id, C2))!;
    await env.ports.systems.update({ ...c2, position: { x: COLUMN, y: 17 * ROW } });
  };

  it('moves a system stored far off the one it hangs off back beside it on the next change', async () => {
    expect(await at(C2)).toEqual({ x: COLUMN, y: 0 });
    await strand();
    await systems.add(alice, map.id, { solarSystemId: TAMA, near: HOME });
    await connections.add(alice, map.id, { source: HOME, target: TAMA, type: 'wormhole' });
    // The new system took the free slot beside home; the strayed one stacks under it.
    expect(await at(TAMA)).toEqual({ x: COLUMN, y: 0 });
    expect(await at(C2)).toEqual({ x: COLUMN, y: ROW });
    const healed = (await env.ports.events.readSince(mapStream(map.id), 0)).filter(
      (e) => e.type === 'system.updated' && (e.data as { solarSystemId: number }).solarSystemId === C2,
    );
    expect(healed.at(-1)?.data).toMatchObject({ position: { x: COLUMN, y: ROW } });
  });

  it('never moves a system someone dragged, until a tidy lays it out again', async () => {
    await systems.move(alice, map.id, { positions: [{ solarSystemId: C2, x: COLUMN, y: 17 * ROW }] });
    await systems.add(alice, map.id, { solarSystemId: JITA, near: HOME });
    expect(await at(C2)).toEqual({ x: COLUMN, y: 17 * ROW });
    await systems.tidy(alice, map.id, true);
    expect(await at(C2)).toEqual({ x: COLUMN, y: 0 });
    // Laid out by the rule now: it heals like any other.
    await strand();
    await systems.add(alice, map.id, { solarSystemId: TAMA, near: C2 });
    expect(await at(C2)).toEqual({ x: COLUMN, y: 0 });
  });

  it('keeps a locked system where it is', async () => {
    await strand();
    await systems.update(alice, map.id, C2, { locked: true });
    await systems.add(alice, map.id, { solarSystemId: TAMA, near: HOME });
    expect(await at(C2)).toEqual({ x: COLUMN, y: 17 * ROW });
  });
});
