import { beforeEach, expect, it } from 'vitest';
import { mapStream, type Actor } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ChainImportUseCases,
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type ChainMap,
} from '@darkbeacon/mapping';
import { account, mappingTestPorts, SYSTEMS } from './testing.js';

const alice = account('alice');
const member = account('bob');
const manager = account('carol');
const autoMapping: Actor = { kind: 'system', id: 'auto-mapping' };
const HOUR = 3_600_000;

describeEachDialect('connection notes, locks and lifetimes; anomalies and custom entries', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  let signatures: SignatureUseCases;
  let map: ChainMap;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    signatures = new SignatureUseCases(env.ports);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Home' });
    env.access.grant('bob', map.id, 'member');
    env.access.grant('carol', map.id, 'manager');
    env.access.grant('auto-mapping', map.id, 'admin');
    for (const id of [SYSTEMS.c2, SYSTEMS.c5, SYSTEMS.c1])
      await systems.add(alice, map.id, { solarSystemId: id });
  });

  it('keeps a note and a lifetime mark on a connection, stamped and used for the time left', async () => {
    const c = await connections.add(member, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 });
    expect(c).not.toHaveProperty('note');
    expect(c).not.toHaveProperty('locked');
    env.clock.advance(1000);
    const marked = await connections.update(member, map.id, c.id, { note: 'Rolled by us', lifetime: '16h' });
    expect(marked).toMatchObject({ note: 'Rolled by us', lifetime: { mark: '16h', at: env.clock.now() } });
    // Read back from the database the same.
    expect((await env.ports.connections.findById(map.id, c.id))!).toMatchObject({
      note: 'Rolled by us',
      lifetime: { mark: '16h', at: env.clock.now() },
    });
    // The same mark again changes nothing (its time stays).
    env.clock.advance(1000);
    expect((await connections.update(member, map.id, c.id, { lifetime: '16h' })).lifetime?.at).toBe(
      marked.lifetime!.at,
    );
    // The mark bounds the time left.
    const intel = (await new ConnectionIntelQuery(env.ports).list(alice, map.id)).find(
      (i) => i.connectionId === c.id,
    )!;
    expect(intel.time.expiresBy).toBeLessThanOrEqual(marked.lifetime!.at + 16 * HOUR);
    // Cleared again, nothing left of it.
    const cleared = await connections.update(member, map.id, c.id, { note: '', lifetime: null });
    expect(cleared).not.toHaveProperty('note');
    expect(cleared).not.toHaveProperty('lifetime');
    const types = (await env.ports.events.readSince(mapStream(map.id), 0)).map((e) => e.type);
    expect(types.filter((x) => x === 'connection.updated')).toHaveLength(2);
  });

  it('lets only managers lock, change and remove locked connections; processes never', async () => {
    const c = await connections.add(member, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 });
    await expect(connections.update(member, map.id, c.id, { locked: true })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const locked = await connections.update(manager, map.id, c.id, { locked: true });
    expect(locked.locked).toBe(true);
    await expect(connections.update(member, map.id, c.id, { massStatus: 'critical' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(connections.remove(member, map.id, c.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(systems.remove(member, map.id, SYSTEMS.c5)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(connections.update(autoMapping, map.id, c.id, { timeStatus: 'eol' })).rejects.toMatchObject({
      code: 'conflict',
    });
    // Adding the pair again (auto-mapping after a jump) leaves it as it is.
    expect(await connections.add(autoMapping, map.id, { source: SYSTEMS.c5, target: SYSTEMS.c2 })).toEqual(
      locked,
    );
    // A manager changes it; unlocking makes it everyone's again.
    expect((await connections.update(manager, map.id, c.id, { massStatus: 'reduced' })).massStatus).toBe(
      'reduced',
    );
    const open = await connections.update(manager, map.id, c.id, { locked: false });
    expect(open).not.toHaveProperty('locked');
    await connections.remove(member, map.id, c.id);
    expect(await env.ports.connections.findById(map.id, c.id)).toBeNull();
  });

  it('keeps anomalies and other scanner rows by kind, and custom entries', async () => {
    const paste = [
      'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.32 AU',
      'JKL-012\tCosmic Anomaly\tCombat Site\tSansha Forsaken Hub\t100.0%\t2.00 AU',
      'PQR-678\tShip\tFrigate\tHeron\t100.0%\t3 km',
    ].join('\n');
    expect(await signatures.paste(member, map.id, SYSTEMS.c2, { text: paste, mode: 'merge' })).toMatchObject({
      added: 3,
    });
    const listed = await signatures.list(member, map.id, SYSTEMS.c2);
    expect(listed.map((s) => [s.eveId, s.kind ?? 'signature', s.group])).toEqual(
      expect.arrayContaining([
        ['ABC-123', 'signature', 'wormhole'],
        ['JKL-012', 'anomaly', 'combat'],
        ['PQR-678', 'other', 'unknown'],
      ]),
    );
    // A custom entry: any short id, but only when it says so.
    await expect(
      signatures.add(member, map.id, SYSTEMS.c2, { eveId: 'Tower 3' } as never),
    ).rejects.toBeDefined();
    const custom = await signatures.add(member, map.id, SYSTEMS.c2, {
      eveId: 'Tower 3',
      custom: true,
      name: 'Our Raitaru',
    });
    expect(custom).toMatchObject({ eveId: 'Tower 3', custom: true });
    expect((await signatures.update(member, map.id, custom.id, { eveId: 'Tower 4' })).eveId).toBe('Tower 4');
    const scanner = listed.find((s) => s.eveId === 'ABC-123')!;
    await expect(signatures.update(member, map.id, scanner.id, { eveId: 'free text' })).rejects.toMatchObject(
      {
        code: 'validation',
      },
    );
    // Replacing with signatures only keeps the anomaly, the ship and the custom entry.
    const result = await signatures.paste(member, map.id, SYSTEMS.c2, {
      text: 'DEF-456\tCosmic Signature\t\t\t0.0%\t1 AU',
      mode: 'replace',
    });
    expect(result).toMatchObject({ added: 1, removed: 1 });
    expect((await signatures.list(member, map.id, SYSTEMS.c2)).map((s) => s.eveId).sort()).toEqual([
      'DEF-456',
      'JKL-012',
      'PQR-678',
      'Tower 4',
    ]);
  });

  it('records imported passages once, with the hull mass from the SDE', async () => {
    const imports = new ChainImportUseCases(env.ports);
    await connections.add(member, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 });
    const passage = {
      source: SYSTEMS.c5,
      target: SYSTEMS.c2,
      characterId: 2112625428,
      shipTypeId: 587,
      occurredAt: 5,
    };
    expect(await imports.putPassage(alice, map.id, passage, 'wanderer.ltd/home:p-1')).toBe('created');
    expect(await imports.putPassage(alice, map.id, passage, 'wanderer.ltd/home:p-1')).toBe('unchanged');
    expect(
      await imports.putPassage(alice, map.id, { ...passage, target: SYSTEMS.c1 }, 'wanderer.ltd/home:p-2'),
    ).toBe('skipped');
    const [recorded] = await env.ports.passages.listForMap(map.id);
    expect(recorded).toMatchObject({
      characterId: 2112625428,
      shipTypeId: 587,
      from: SYSTEMS.c5,
      to: SYSTEMS.c2,
    });
    expect(recorded!.mass).toBeGreaterThan(1_000_000);
  });
});
