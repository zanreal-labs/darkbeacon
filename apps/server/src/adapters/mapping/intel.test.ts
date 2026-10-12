import { beforeEach, expect, it } from 'vitest';
import { mapStream } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapUseCases,
  PassageRecorder,
  SignatureUseCases,
  SystemUseCases,
  type ChainMap,
} from '@darkbeacon/mapping';
import { account, mappingTestPorts } from './testing.js';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';

const HOUR = 60 * 60 * 1000;
const HOME = 31002531; // J014348, C3: D845 (HS), U210 (LS)
const C2 = 31000399; // J130256, C2: B274 (HS), O477 (C3)
const TAMA = 30002813; // low-sec
const JITA = 30000142;
const PERIMETER = 30000144;
const RIFTER = 587; // 1 067 000 kg
const RAVEN = 638;

const alice = account('alice');
const bob = account('bob');

describeEachDialect('connections panel', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let connections: ConnectionUseCases;
  let signatures: SignatureUseCases;
  let intel: ConnectionIntelQuery;
  let passages: PassageRecorder;
  let jumpId = 0;

  const universe = StaticUniverseCatalog.load('/nonexistent');

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.universe = universe;
    env.clock.set(1_000_000_000);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    env.access.grant('bob', map.id, 'viewer');
    const systems = new SystemUseCases(env.ports);
    for (const id of [HOME, C2, TAMA, JITA, PERIMETER])
      await systems.add(alice, map.id, { solarSystemId: id });
    connections = new ConnectionUseCases(env.ports);
    signatures = new SignatureUseCases(env.ports);
    intel = new ConnectionIntelQuery(env.ports);
    passages = new PassageRecorder(env.ports);
  });

  const connect = (source: number, target: number) => connections.add(alice, map.id, { source, target });
  const sig = async (system: number, eveId: string, type: string | null, connectionId: string) => {
    const added = await signatures.add(alice, map.id, system, { eveId });
    return signatures.update(alice, map.id, added.id, { type, connectionId });
  };
  const jump = (from: number, to: number, ship: number | null) =>
    passages.record({
      mapId: map.id,
      eventId: `jump-${++jumpId}`,
      characterId: 9001,
      shipTypeId: ship,
      from,
      to,
      occurredAt: env.clock.now(),
    });
  const one = async (connectionId: string) =>
    (await intel.list(bob, map.id)).find((c) => c.connectionId === connectionId)!;

  it('resolves the type from either side, K162 on the other, and inherits its size', async () => {
    const c = await connect(HOME, C2);
    expect(c.shipSize).toBe('large');
    await sig(HOME, 'ABC-123', 'K162', c.id);
    await sig(C2, 'XYZ-789', 'O477', c.id);
    const row = await one(c.id);
    expect(row).toMatchObject({
      wormholeType: 'O477',
      wormholeTypeFrom: 'signature',
      wormholeTypeSide: 'target',
      source: { name: 'J014348', classLabel: 'C3', signature: { eveId: 'ABC-123', type: 'K162' } },
      target: { name: 'J130256', classLabel: 'C2', signature: { eveId: 'XYZ-789', type: 'O477' } },
      maxJumpMass: 375_000_000,
      mass: { total: 2_000_000_000, remaining: 2_000_000_000, passages: 0 },
      time: { lifetimeHours: 16 },
      urgency: 'ok',
    });
    expect(row.fits).toContain('battleship');
    expect(row.fits).not.toContain('freighter');

    // A frigate hole makes the connection small.
    const frig = await connect(C2, TAMA);
    await sig(C2, 'FRG-001', 'E004', frig.id);
    expect((await env.ports.connections.findById(map.id, frig.id))?.shipSize).toBe('small');
    const events = await env.ports.events.readSince(mapStream(map.id), 0);
    expect(events.filter((e) => e.type === 'connection.updated').at(-1)?.data).toMatchObject({
      shipSize: 'small',
    });
    expect((await one(frig.id)).mass).toMatchObject({ regenerates: true, remaining: 3_000_000_000 });
    expect((await one(frig.id)).fits).toEqual(['frigate', 'destroyer']);
  });

  it('guesses the type from the one static that leads there', async () => {
    const out = await connect(HOME, TAMA);
    expect(await one(out.id)).toMatchObject({
      wormholeType: 'U210',
      wormholeTypeFrom: 'static',
      wormholeTypeSide: 'source',
    });
    // A K162 on the J-space side means the hole is not that static.
    await sig(HOME, 'KKK-162', 'K162', out.id);
    expect((await one(out.id)).wormholeType).toBeNull();
    // Gates have no wormhole type, mass or lifetime.
    const gate = await connect(JITA, PERIMETER);
    expect(await one(gate.id)).toMatchObject({
      type: 'gate',
      wormholeType: null,
      mass: { total: null },
      time: { expiresBy: null },
      urgency: 'ok',
    });
    expect((await one(gate.id)).fits).toContain('capital');
  });

  it('estimates mass from passages since the mass status was set', async () => {
    const c = await connect(HOME, TAMA); // U210: 3 000 000 t, 375 000 t per jump
    await sig(HOME, 'UUU-210', 'U210', c.id);
    expect(await jump(HOME, TAMA, RIFTER)).toBe(true);
    expect(await jump(TAMA, HOME, null)).toBe(true);
    expect(await jump(JITA, PERIMETER, RIFTER)).toBe(false); // no such connection
    let row = await one(c.id);
    expect(row.mass).toMatchObject({
      total: 3_000_000_000,
      passed: 1_067_000,
      passages: 2,
      unknownPassages: 1,
      remaining: 3_000_000_000 - 1_067_000,
      estimatedStatus: 'fresh',
    });
    expect(row.totalPassages).toBe(2);

    // Marked reduced: at most half is left, minus what passes from now on.
    env.clock.advance(1000);
    await connections.update(alice, map.id, c.id, { massStatus: 'reduced' });
    env.clock.advance(1000);
    for (let i = 0; i < 10; i++) await jump(HOME, TAMA, RAVEN);
    row = await one(c.id);
    const raven = universe.shipMass(RAVEN)!;
    expect(row.mass.passed).toBeCloseTo(10 * raven);
    expect(row.mass.remaining).toBeCloseTo(1_500_000_000 - 10 * raven);
    expect(row.mass.passages).toBe(10);
    expect(row.totalPassages).toBe(12);

    const list = await intel.passages(bob, map.id, c.id);
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ connectionId: c.id, characterId: 9001, shipTypeId: RAVEN, mass: raven });

    // The same jump event is recorded once.
    expect(
      await passages.record({
        mapId: map.id,
        eventId: 'jump-1',
        characterId: 9001,
        shipTypeId: RIFTER,
        from: HOME,
        to: TAMA,
        occurredAt: env.clock.now(),
      }),
    ).toBe(false);
    const published = (await env.ports.events.readSince(mapStream(map.id), 0)).filter(
      (e) => e.type === 'connection.passage',
    );
    expect(published).toHaveLength(12);
    expect(published[0]?.data).toMatchObject({ connectionId: c.id, mass: 1_067_000, from: HOME, to: TAMA });
  });

  it('estimates time left from when the hole was first seen and from EOL, most urgent first', async () => {
    const old = await connect(HOME, TAMA); // U210 lives 24 h
    await sig(HOME, 'UUU-210', 'U210', old.id);
    env.clock.advance(20 * HOUR);
    const fresh = await connect(HOME, C2);
    const gate = await connect(JITA, PERIMETER);
    let rows = await intel.list(bob, map.id);
    expect(rows.find((r) => r.connectionId === old.id)?.time).toMatchObject({
      lifetimeHours: 24,
      remainingMs: 4 * HOUR,
    });
    expect(rows.find((r) => r.connectionId === old.id)?.urgency).toBe('ok');

    env.clock.advance(1 * HOUR); // 3 h left: warning
    await connections.update(alice, map.id, fresh.id, { timeStatus: 'eol' });
    env.clock.advance(3.5 * HOUR); // fresh: 30 min of EOL left; old: gone by now
    rows = await intel.list(bob, map.id);
    expect(rows.map((r) => r.connectionId)).toEqual([old.id, fresh.id, gate.id]);
    expect(rows[0]).toMatchObject({ urgency: 'critical', time: { remainingMs: 0 } });
    expect(rows[1]).toMatchObject({ urgency: 'critical', time: { remainingMs: 0.5 * HOUR } });
    expect(rows[2]).toMatchObject({ urgency: 'ok' });

    await connections.update(alice, map.id, gate.id, { massStatus: 'critical' });
    expect((await one(gate.id)).urgency).toBe('ok'); // gates never collapse
  });

  it('is for viewers of the map only', async () => {
    await expect(intel.list(account('eve'), map.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});
