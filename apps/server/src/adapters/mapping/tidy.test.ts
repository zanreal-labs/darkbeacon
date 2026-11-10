import { beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ConnectionUseCases, MapUseCases, SystemUseCases, type ChainMap } from '@darkbeacon/mapping';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { account, mappingTestPorts } from './testing.js';

const HOME = 31002531; // C3
const C2 = 31000399;
const TAMA = 30002813; // low-sec, out of the C2
const JITA = 30000142;
const PERIMETER = 30000144; // a gate from Jita
const AMARR = 30002187; // a cyno or bridge away from Perimeter

const alice = account('alice');

describeEachDialect('tidying the chain', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.universe = StaticUniverseCatalog.load('/nonexistent');
    env.clock.set(1_000_000_000);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    // Scattered the way a copied Wanderer layout left them: on top of each other and far off.
    const at: Array<[number, number, number]> = [
      [HOME, 0, 0],
      [C2, 0, 48],
      [TAMA, 3000, 4000],
      [JITA, 312, 0],
      [PERIMETER, 312, 0],
      [AMARR, -2000, 900],
    ];
    for (const [solarSystemId, x, y] of at)
      await systems.add(alice, map.id, { solarSystemId, position: { x, y } });
    await systems.update(alice, map.id, HOME, { status: 'home' });
    await connections.add(alice, map.id, { source: HOME, target: C2, type: 'wormhole' });
    await connections.add(alice, map.id, { source: C2, target: TAMA, type: 'wormhole' });
    await connections.add(alice, map.id, { source: JITA, target: PERIMETER, type: 'gate' });
    await connections.add(alice, map.id, { source: PERIMETER, target: AMARR, type: 'bridge' });
    await systems.update(alice, map.id, AMARR, { locked: true });
  });

  it('previews, then hides what is off the chain and lays the chain out from home', async () => {
    const preview = await systems.tidy(alice, map.id, false);
    expect(preview.hidden.sort()).toEqual([JITA, PERIMETER, AMARR].sort());
    expect(preview.moved).toBe(2);
    // A preview changes nothing.
    expect((await env.ports.systems.list(map.id)).filter((s) => s.visible)).toHaveLength(6);

    await systems.tidy(alice, map.id, true);
    const shown = (await env.ports.systems.list(map.id)).filter((s) => s.visible);
    expect(shown.map((s) => s.solarSystemId).sort()).toEqual([HOME, C2, TAMA].sort());
    const pos = new Map(shown.map((s) => [s.solarSystemId, s.position]));
    // Home stays; each system a column further out, in its parent's row.
    expect(pos.get(HOME)).toEqual({ x: 0, y: 0 });
    expect(pos.get(C2)).toEqual({ x: 360, y: 0 });
    expect(pos.get(TAMA)).toEqual({ x: 720, y: 0 });
    expect(await env.ports.connections.list(map.id)).toHaveLength(2);
    // Run again: nothing left to do.
    expect(await systems.tidy(alice, map.id, true)).toEqual({ hidden: [], kept: [], moved: 0 });
  });

  it('is for map managers', async () => {
    await expect(systems.tidy(account('mallory'), map.id, false)).rejects.toThrow();
  });
});
