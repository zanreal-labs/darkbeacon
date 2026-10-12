import { beforeEach, expect, it } from 'vitest';
import { mapStream } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapUseCases,
  PassageRecorder,
  PassageUseCases,
  SignatureUseCases,
  SystemUseCases,
  type ChainMap,
} from '@darkbeacon/mapping';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { account, mappingTestPorts } from './testing.js';

const HOME = 31002531; // J014348, C3: D845 (HS), U210 (LS)
const TAMA = 30002813; // low-sec
const MEGATHRON = 641; // 98 400 t
const ORCA = 28606; // 150 000 t
const ONYX = 11995; // 15 400 t, a heavy interdiction cruiser

const alice = account('alice');
const bob = account('bob');

describeEachDialect('passage log and rolling', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let connections: ConnectionUseCases;
  let log: PassageUseCases;
  let intel: ConnectionIntelQuery;
  let connectionId: string;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.universe = StaticUniverseCatalog.load('/nonexistent');
    env.ports.pilots = { names: async (ids) => new Map(ids.map((id) => [id, `Pilot ${id}`])) };
    env.clock.set(1_000_000_000);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    env.access.grant('bob', map.id, 'viewer');
    const systems = new SystemUseCases(env.ports);
    for (const id of [HOME, TAMA]) await systems.add(alice, map.id, { solarSystemId: id });
    connections = new ConnectionUseCases(env.ports);
    const c = await connections.add(alice, map.id, { source: HOME, target: TAMA });
    connectionId = c.id;
    // U210: 3 000 000 t in all, 375 000 t a jump, 24 h.
    const signatures = new SignatureUseCases(env.ports);
    const sig = await signatures.add(alice, map.id, HOME, { eveId: 'UUU-210' });
    await signatures.update(alice, map.id, sig.id, { type: 'U210', connectionId });
    log = new PassageUseCases(env.ports);
    intel = new ConnectionIntelQuery(env.ports);
  });

  const events = async (type: string) =>
    (await env.ports.events.readSince(mapStream(map.id), 0)).filter((e) => e.type === type);

  it('logs jumps of pilots nobody tracks, hot, cold or custom, several at once', async () => {
    const hot = await log.log(alice, map.id, connectionId, {
      shipTypeId: MEGATHRON,
      direction: 'sourceToTarget',
      massMode: 'hot',
      count: 3,
      note: 'Roller 1',
    });
    expect(hot).toHaveLength(3);
    expect(hot[0]).toMatchObject({
      characterId: null,
      shipTypeId: MEGATHRON,
      shipName: 'Megathron',
      mass: 148_400_000,
      from: HOME,
      to: TAMA,
      source: 'manual',
      massMode: 'hot',
      note: 'Roller 1',
      counted: true,
    });
    env.clock.advance(1000);
    const cold = await log.log(alice, map.id, connectionId, {
      shipTypeId: ORCA,
      direction: 'targetToSource',
      higgs: true,
    });
    expect(cold[0]).toMatchObject({ from: TAMA, to: HOME, massMode: 'cold', higgs: true, mass: 300_000_000 });
    const custom = await log.log(alice, map.id, connectionId, {
      shipTypeId: ONYX,
      direction: 'sourceToTarget',
      massMode: 'custom',
      mass: 2_000_000,
    });
    expect(custom[0]).toMatchObject({ massMode: 'custom', mass: 2_000_000 });

    const published = await events('connection.passage');
    expect(published).toHaveLength(5);
    expect(published[0]?.data).toMatchObject({ source: 'manual', massMode: 'hot', characterId: null });
    expect(published[0]?.actor).toMatchObject({ kind: 'account', id: 'alice' });

    const row = await intel.one(bob, map.id, connectionId);
    expect(row.mass).toMatchObject({ passages: 5, passed: 3 * 148_400_000 + 300_000_000 + 2_000_000 });
    expect(row.mass.range?.min).toBeCloseTo(0.5 * 2_700_000_000 - row.mass.passed);
    expect(row.mass.range?.max).toBeCloseTo(3_300_000_000 - row.mass.passed);
  });

  it('refuses viewers, unknown ships, modules that do not fit and custom without a mass', async () => {
    await expect(
      log.log(bob, map.id, connectionId, { shipTypeId: MEGATHRON, direction: 'sourceToTarget' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      log.log(alice, map.id, connectionId, { shipTypeId: 1, direction: 'sourceToTarget' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      log.log(alice, map.id, connectionId, {
        shipTypeId: MEGATHRON,
        direction: 'sourceToTarget',
        entangler: true,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      log.log(alice, map.id, connectionId, {
        shipTypeId: MEGATHRON,
        direction: 'sourceToTarget',
        massMode: 'custom',
      }),
    ).rejects.toThrow();
  });

  it('sets a tracked jump hot, then custom, and deletes a mistake, all audited', async () => {
    await new PassageRecorder(env.ports).record({
      mapId: map.id,
      eventId: 'jump-1',
      characterId: 90000001,
      shipTypeId: MEGATHRON,
      from: HOME,
      to: TAMA,
      occurredAt: env.clock.now(),
    });
    const [tracked] = await log.list(bob, map.id, connectionId);
    expect(tracked).toMatchObject({ source: 'tracked', characterName: 'Pilot 90000001', mass: 98_400_000 });
    const hot = await log.update(alice, map.id, connectionId, tracked!.id, { massMode: 'hot' });
    expect(hot).toMatchObject({ massMode: 'hot', mass: 148_400_000, characterId: 90000001 });
    const custom = await log.update(alice, map.id, connectionId, tracked!.id, {
      massMode: 'custom',
      mass: 250_000_000,
      note: 'plated',
    });
    expect(custom).toMatchObject({ massMode: 'custom', mass: 250_000_000, note: 'plated' });
    const updated = await events('connection.passage_updated');
    expect(updated).toHaveLength(2);
    expect(updated[0]?.data).toMatchObject({ passageId: tracked!.id, massMode: 'hot', mass: 148_400_000 });

    await expect(log.remove(bob, map.id, connectionId, tracked!.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await log.remove(alice, map.id, connectionId, tracked!.id);
    expect(await log.list(bob, map.id, connectionId)).toEqual([]);
    expect((await events('connection.passage_removed'))[0]?.data).toEqual({
      passageId: tracked!.id,
      connectionId,
    });
    await expect(log.remove(alice, map.id, connectionId, tracked!.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('counts only since the mass status was set or the counter reset, keeping the history', async () => {
    await log.log(alice, map.id, connectionId, { shipTypeId: MEGATHRON, direction: 'sourceToTarget' });
    env.clock.advance(1000);
    await connections.update(alice, map.id, connectionId, { massStatus: 'reduced' });
    env.clock.advance(1000);
    await log.log(alice, map.id, connectionId, { shipTypeId: ORCA, direction: 'targetToSource' });
    let row = await intel.one(bob, map.id, connectionId);
    expect(row.mass).toMatchObject({ passages: 1, passed: 150_000_000 });
    expect((await log.list(bob, map.id, connectionId)).map((p) => p.counted)).toEqual([true, false]);

    env.clock.advance(1000);
    const reset = await log.resetCounter(alice, map.id, connectionId);
    expect(reset.massStatusAt).toBe(env.clock.now());
    row = await intel.one(bob, map.id, connectionId);
    expect(row.mass).toMatchObject({ passages: 0, passed: 0, since: env.clock.now() });
    expect(row.totalPassages).toBe(2);
    expect((await events('connection.updated')).at(-1)?.data).toMatchObject({
      massStatusAt: env.clock.now(),
    });
  });

  it('plans a roll with the crew’s ships from the hole’s estimate', async () => {
    await connections.update(alice, map.id, connectionId, { massStatus: 'critical' });
    const plan = await intel.rollPlan(bob, map.id, connectionId, {
      ships: [{ shipTypeId: MEGATHRON }, { shipTypeId: ONYX, entangler: true }],
    });
    expect(plan).toMatchObject({
      result: 'risky',
      reason: 'strand',
      maxJumpMass: 375_000_000,
      remaining: { min: 0, max: 330_000_000 },
    });
    expect(plan.crew).toEqual([
      { shipTypeId: MEGATHRON, name: 'Megathron', cold: 98_400_000, hot: 148_400_000, tooHeavy: false },
      // Out with the entangler on, home hot with it off.
      { shipTypeId: ONYX, name: 'Onyx + entangler', cold: 3_080_000, hot: 20_400_000, tooHeavy: false },
    ]);
    expect(plan.steps[0]).toMatchObject({ shipName: 'Onyx + entangler', direction: 'out', collapse: 'may' });
    expect(plan.steps.at(-1)).toMatchObject({ direction: 'back', collapse: 'will' });

    // With what the crew knows instead of the estimate.
    const known = await intel.rollPlan(bob, map.id, connectionId, {
      ships: [{ shipTypeId: MEGATHRON, higgs: true }],
      remaining: { min: 200_000_000, max: 290_000_000 },
    });
    expect(known).toMatchObject({ result: 'ok', reason: 'collapses' });
    expect(known.steps).toHaveLength(2);
  });
});
