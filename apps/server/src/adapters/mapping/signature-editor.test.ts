import { beforeEach, expect, it } from 'vitest';
import { mapStream, type Actor, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  CommentUseCases,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  StructureUseCases,
  SystemUseCases,
  type ChainMap,
  type Connection,
} from '@darkbeacon/mapping';
import { KyselyCommentRepository, KyselyStructureRepository } from './kysely-intel.js';
import { account, mappingTestPorts, SYSTEMS } from './testing.js';

const alice = account('alice');
const bob = account('bob');
const viewer = account('vic');
const DAY = 24 * 60 * 60 * 1000;

describeEachDialect('signatures, comments and structures', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let maps: MapUseCases;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;
  let signatures: SignatureUseCases;
  let comments: CommentUseCases;
  let structures: StructureUseCases;
  let map: ChainMap;
  let hole: Connection;

  const types = async (since: number) =>
    (await env.ports.events.readSince(mapStream(map.id), since)).map((e: DomainEvent) => e.type);
  const head = () => env.ports.events.headSeq(mapStream(map.id));

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.authors = {
      author: async (actor: Actor) =>
        actor.kind === 'account'
          ? { accountId: actor.id, characterId: 90000001, name: `${actor.id} Main` }
          : null,
    };
    maps = new MapUseCases(env.ports);
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    signatures = new SignatureUseCases(env.ports);
    comments = new CommentUseCases({ ...env.ports, comments: new KyselyCommentRepository(t.db) });
    structures = new StructureUseCases({ ...env.ports, structures: new KyselyStructureRepository(t.db) });
    map = await maps.create(alice, { name: 'Home Chain' });
    env.access.grant('bob', map.id, 'member');
    env.access.grant('vic', map.id, 'viewer');
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c2 });
    await systems.add(bob, map.id, { solarSystemId: SYSTEMS.c5 });
    hole = await connections.add(bob, map.id, { source: SYSTEMS.c2, target: SYSTEMS.c5 });
  });

  it('names who added and who changed a signature, and keeps the editor fields', async () => {
    const sig = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'ABC-123', group: 'wormhole' });
    expect(sig.createdBy).toEqual({ accountId: 'bob', characterId: 90000001, name: 'bob Main' });
    const edited = await signatures.update(alice, map.id, sig.id, {
      type: 'K162',
      destination: 'c4_c5',
      bubbled: true,
      tempName: 'Bob',
      description: '**camped**',
    });
    expect(edited).toMatchObject({
      createdBy: { name: 'bob Main' },
      updatedBy: { name: 'alice Main' },
      destination: 'c4_c5',
      bubbled: true,
      tempName: 'Bob',
    });
    expect(await env.ports.signatures.findById(map.id, sig.id)).toEqual(edited);
  });

  it('linking gives the connection size, lifetime and mass, and the far system the temporary name', async () => {
    const forward = await signatures.add(bob, map.id, SYSTEMS.c2, {
      eveId: 'FWD-001',
      type: 'A009',
      tempName: 'Frig',
      timeStatus: 'eol',
    });
    const seq = await head();
    const linked = await signatures.update(bob, map.id, forward.id, { connectionId: hole.id });
    expect(linked.group).toBe('wormhole');
    expect(await env.ports.connections.findById(map.id, hole.id)).toMatchObject({
      shipSize: 'small',
      timeStatus: 'eol',
    });
    expect((await env.ports.systems.find(map.id, SYSTEMS.c5))?.temporaryName).toBe('Frig');
    expect(await types(seq)).toEqual(['signature.updated', 'connection.updated', 'system.updated']);

    // The K162 on the far side takes what the forward side said.
    const back = await signatures.add(bob, map.id, SYSTEMS.c5, { eveId: 'KKK-162', type: 'K162' });
    const mirrored = await signatures.update(bob, map.id, back.id, { connectionId: hole.id });
    expect(mirrored).toMatchObject({ timeStatus: 'eol', connectionId: hole.id });

    // Mass set later on a linked signature goes to the connection.
    await signatures.update(bob, map.id, forward.id, { massStatus: 'critical' });
    expect((await env.ports.connections.findById(map.id, hole.id))?.massStatus).toBe('critical');

    // A second signature linked to the same end takes the link over.
    const other = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'OTH-002' });
    await signatures.update(bob, map.id, other.id, { connectionId: hole.id });
    expect((await env.ports.signatures.findById(map.id, forward.id))?.connectionId).toBeNull();
  });

  it('removes several at once with cascades and puts them back', async () => {
    const here = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'AAA-111', type: 'H296' });
    const there = await signatures.add(bob, map.id, SYSTEMS.c5, { eveId: 'BBB-222', type: 'K162' });
    const site = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'CCC-333', group: 'relic' });
    await signatures.update(bob, map.id, here.id, { connectionId: hole.id });
    await signatures.update(bob, map.id, there.id, { connectionId: hole.id });

    await expect(signatures.removeMany(viewer, map.id, SYSTEMS.c2, { ids: [site.id] })).rejects.toMatchObject(
      { code: 'forbidden' },
    );

    // Back link: the K162 that leads back goes with it, the connection stays.
    const removed = await signatures.removeMany(bob, map.id, SYSTEMS.c2, {
      ids: [here.id, site.id],
      backLinks: true,
    });
    expect(removed.signatures.map((s) => s.eveId).sort()).toEqual(['AAA-111', 'BBB-222', 'CCC-333']);
    expect(removed.connectionIds).toEqual([]);
    expect(await env.ports.connections.findById(map.id, hole.id)).not.toBeNull();

    // Undo: same ids, authors and link.
    const restored = await signatures.restore(alice, map.id, removed.signatures);
    expect(restored.map((s) => s.id).sort()).toEqual([here.id, there.id, site.id].sort());
    expect((await env.ports.signatures.findById(map.id, here.id))?.connectionId).toBe(hole.id);
    expect((await env.ports.signatures.findById(map.id, here.id))?.createdBy?.name).toBe('bob Main');
    // A code in use again is skipped.
    expect(await signatures.restore(alice, map.id, removed.signatures)).toEqual([]);

    // With connections: the hole and its far-side signature go too.
    const all = await signatures.removeMany(bob, map.id, SYSTEMS.c2, {
      ids: [here.id],
      withConnections: true,
    });
    expect(all.connectionIds).toEqual([hole.id]);
    expect(all.signatures.map((s) => s.eveId).sort()).toEqual(['AAA-111', 'BBB-222']);
    expect(await env.ports.connections.findById(map.id, hole.id)).toBeNull();
  });

  it('removing a connection can take its signatures and the temporary name they gave', async () => {
    const sig = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'TMP-001', tempName: 'Alpha' });
    await signatures.update(bob, map.id, sig.id, { connectionId: hole.id });
    expect((await env.ports.systems.find(map.id, SYSTEMS.c5))?.temporaryName).toBe('Alpha');
    await connections.remove(bob, map.id, hole.id, { withSignatures: true });
    expect(await env.ports.signatures.findById(map.id, sig.id)).toBeNull();
    expect((await env.ports.systems.find(map.id, SYSTEMS.c5))?.temporaryName).toBeNull();
  });

  it('sweeps signatures nobody changed or scanned for the map retention', async () => {
    const old = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'OLD-001' });
    const seen = await signatures.add(bob, map.id, SYSTEMS.c2, { eveId: 'SEE-002' });
    env.clock.advance(10 * DAY);
    // Seen again in a scan: kept fresh.
    await signatures.paste(bob, map.id, SYSTEMS.c2, {
      text: 'SEE-002\tCosmic Signature\t\t\t0.0%\t1 AU',
      mode: 'merge',
    });
    env.clock.advance(5 * DAY);
    expect(await signatures.sweep()).toBe(1);
    expect(await env.ports.signatures.findById(map.id, old.id)).toBeNull();
    expect(await env.ports.signatures.findById(map.id, seen.id)).not.toBeNull();

    // A deleted map waits as it was, for a restore.
    await maps.remove(alice, map.id);
    env.clock.advance(30 * DAY);
    expect(await signatures.sweep()).toBe(0);
    expect(await env.ports.signatures.findById(map.id, seen.id)).not.toBeNull();
    const trashed = (await env.ports.maps.findById(map.id))!;
    const { deletedAt: _gone, ...restored } = trashed;
    await env.ports.maps.update(restored);

    // 0 keeps everything.
    await maps.update(alice, map.id, { settings: { signatureRetentionDays: 0 } });
    env.clock.advance(60 * DAY);
    expect(await signatures.sweep()).toBe(0);
  });

  it('keeps comment threads, newest first; members write and remove, viewers read', async () => {
    const first = await comments.add(bob, map.id, SYSTEMS.c2, { text: 'Keepstar on d-scan' });
    env.clock.advance(1000);
    const second = await comments.add(alice, map.id, SYSTEMS.c2, { text: 'Gone **now**' });
    expect(second.author?.name).toBe('alice Main');
    expect((await comments.list(viewer, map.id, SYSTEMS.c2)).map((c) => c.id)).toEqual([second.id, first.id]);
    await expect(comments.add(viewer, map.id, SYSTEMS.c2, { text: 'x' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const seq = await head();
    await comments.remove(bob, map.id, second.id);
    expect(await types(seq)).toEqual(['comment.removed']);
    expect(await comments.counts(viewer, map.id)).toEqual(new Map([[SYSTEMS.c2, 1]]));
  });

  it('pastes structures from d-scan and their timers, and sets owners', async () => {
    const pasted = await structures.paste(
      bob,
      map.id,
      SYSTEMS.c2,
      [
        '35832\tJ100101 - Home\tAstrahus\t1,234 km',
        '35835\tMoon Drill\tAthanor\t2 AU',
        '35832\tJ100101 - Home\tAstrahus\t1,234 km',
        '12345\tSomething\tShip\t1 km',
      ].join('\n'),
    );
    expect(pasted).toEqual({ added: 2, updated: 0, skipped: ['12345\tSomething\tShip\t1 km'] });
    // Pasting again adds nothing.
    expect((await structures.paste(bob, map.id, SYSTEMS.c2, '35832\tHome\tAstrahus\t1 km')).added).toBe(0);

    const timer = await structures.paste(
      bob,
      map.id,
      SYSTEMS.c2,
      'J100101 - Home\n1,475 km\nReinforced until 2026.10.13 23:51',
    );
    expect(timer.updated).toBe(1);
    const list = await structures.list(viewer, map.id, SYSTEMS.c2);
    expect(list[0]).toMatchObject({
      name: 'Home',
      typeName: 'Astrahus',
      status: 'reinforced',
      endsAt: Date.UTC(2026, 9, 13, 23, 51),
    });

    // A status without a timer clears it.
    const powered = await structures.update(bob, map.id, list[0]!.id, { status: 'powered' });
    expect(powered.endsAt).toBeNull();

    const owner = { id: 98000001, name: 'Some Corp', ticker: 'SOME' };
    const owned = await structures.setOwners(bob, map.id, SYSTEMS.c2, owner);
    expect(owned.every((s) => s.owner?.ticker === 'SOME')).toBe(true);
    expect((await structures.listMap(viewer, map.id)).length).toBe(2);
  });
});
