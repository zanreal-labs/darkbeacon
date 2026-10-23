import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapStream, newEvent, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { BookmarkNumberUseCases, type ChainMap } from '@darkbeacon/mapping';
import { shareScope } from '@darkbeacon/shared';
import type {
  ConnectionDto,
  MapShareDto,
  MapSourceDto,
  MapSystemDto,
  ShareScope,
  SignatureDto,
} from '@darkbeacon/shared';
import { account, SYSTEMS } from '../mapping/testing.js';
import { sharingTestEnv } from './testing.js';

const alice = account('alice'); // admin of Corp A
const bob = account('bob'); // admin of Corp B
const carol = account('carol'); // admin of the alliance chain
const dave = account('dave'); // member of the alliance chain only
const vic = account('vic'); // viewer of the alliance chain only

const { c2, c5, c1, shattered } = SYSTEMS;

describeEachDialect('sharing and merged chains', (t) => {
  let env: ReturnType<typeof sharingTestEnv>;
  let corpA: ChainMap;
  let corpB: ChainMap;
  let alliance: ChainMap;

  /** The merged snapshot of a map as its viewers get it. */
  const view = async (mapId: string, as = carol) => {
    const snapshot = await env.snapshots.snapshot(as, mapId);
    const extra = (await env.merger.snapshot(mapId)) as { sources?: MapSourceDto[] };
    return { ...snapshot, sources: extra.sources };
  };
  const edge = (connections: ConnectionDto[], a: number, b: number) =>
    connections.find((c) => (c.source === a && c.target === b) || (c.source === b && c.target === a));
  const types = (events: DomainEvent[]) => events.map((e) => e.type);

  async function share(
    source: ChainMap,
    by: typeof alice,
    level: 'read' | 'read-write',
    scopes?: ShareScope[],
  ): Promise<MapShareDto> {
    const offered = await env.sharing.offer(by, source.id, {
      targetMapId: alliance.id,
      level,
      ...(scopes ? { scopes } : {}),
    });
    const accepted = await env.sharing.accept(carol, alliance.id, offered.id, {});
    await env.settle();
    return accepted;
  }

  // Merges still running when a test ends would outlive its database.
  afterEach(() => env.settle());

  beforeEach(async () => {
    env = sharingTestEnv(t.db);
    corpA = await env.maps.create(alice, { name: 'Corp A' });
    corpB = await env.maps.create(bob, { name: 'Corp B' });
    alliance = await env.maps.create(carol, { name: 'Alliance chain', kind: 'composite' });
    env.access.grant('dave', alliance.id, 'member');
    env.access.grant('vic', alliance.id, 'viewer');
    // Alice may see the alliance chain (to pick it), but administers only Corp A.
    env.access.grant('alice', alliance.id, 'viewer');

    // Corp A: C2 - C5 - C1. Corp B: C5 - C1 - shattered. They overlap on C5 - C1.
    for (const id of [c2, c5, c1]) await env.systems.add(alice, corpA.id, { solarSystemId: id });
    await env.connections.add(alice, corpA.id, { source: c2, target: c5 });
    const aEdge = await env.connections.add(alice, corpA.id, { source: c5, target: c1 });
    for (const id of [c1, c5, shattered]) await env.systems.add(bob, corpB.id, { solarSystemId: id });
    const bEdge = await env.connections.add(bob, corpB.id, { source: c1, target: c5 });
    await env.connections.add(bob, corpB.id, { source: c1, target: shattered });
    // They disagree about the mass of C5 - C1: B looked later.
    env.clock.advance(1_000);
    await env.connections.update(alice, corpA.id, aEdge.id, { massStatus: 'reduced' });
    env.clock.advance(1_000);
    await env.connections.update(bob, corpB.id, bEdge.id, { massStatus: 'critical' });
    await env.settle();
  });

  it('asks for consent: offered by the source admin, accepted by the target admin', async () => {
    await expect(
      env.sharing.offer(dave, corpA.id, { targetMapId: alliance.id, level: 'read' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const offered = await env.sharing.offer(alice, corpA.id, { targetSlug: alliance.slug, level: 'read' });
    expect(offered).toMatchObject({
      status: 'offered',
      sourceName: 'Corp A',
      targetName: 'Alliance chain',
      scopes: ['topology', 'connectionStatus', 'signatures'],
    });
    // Nothing is merged before the target's admin accepts.
    await env.settle();
    expect((await view(alliance.id)).systems).toEqual([]);
    await expect(
      env.sharing.offer(alice, corpA.id, { targetMapId: alliance.id, level: 'read' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(env.sharing.accept(alice, corpA.id, offered.id, {})).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(env.sharing.accept(dave, alliance.id, offered.id, {})).rejects.toMatchObject({
      code: 'forbidden',
    });

    expect((await env.sharing.list(carol, alliance.id)).incoming).toEqual([offered]);
    expect((await env.sharing.list(alice, corpA.id)).outgoing).toEqual([offered]);
    await expect(env.sharing.list(vic, alliance.id)).rejects.toMatchObject({ code: 'forbidden' });

    const accepted = await env.sharing.accept(carol, alliance.id, offered.id, {});
    expect(accepted.status).toBe('active');
    await env.settle();
    expect((await view(alliance.id)).systems.map((s) => s.solarSystemId).sort()).toEqual([c2, c5, c1].sort());

    // Both maps' histories have the share.
    expect(types(await env.events(corpA.id))).toEqual(
      expect.arrayContaining(['map.share.offered', 'map.share.accepted']),
    );
    expect(types(await env.events(alliance.id))).toEqual(
      expect.arrayContaining(['map.share.offered', 'map.share.accepted', 'map.sources_changed']),
    );

    // One admin of both maps shares in one step.
    env.access.grant('bob', alliance.id, 'admin');
    const direct = await env.sharing.offer(bob, corpB.id, { targetMapId: alliance.id, level: 'read' });
    expect(direct.status).toBe('active');
  });

  it('merges overlapping chains into one node per system, newest values winning per field', async () => {
    await share(corpA, alice, 'read');
    await share(corpB, bob, 'read');
    const merged = await view(alliance.id);
    expect(merged.systems.map((s) => s.solarSystemId).sort()).toEqual([c2, c5, c1, shattered].sort());
    expect(merged.connections).toHaveLength(3);
    const overlap = edge(merged.connections, c5, c1)!;
    expect(overlap).toMatchObject({ massStatus: 'critical', mapId: alliance.id });
    expect(overlap.provenance).toMatchObject({ updatedBy: merged.sources![2]!.id, writable: false });
    expect(overlap.provenance!.sources).toHaveLength(2);
    expect(merged.sources!.map((s) => s.name)).toEqual(['Alliance chain', 'Corp A', 'Corp B']);
    // Positions are the composite's own and do not cover each other.
    const spots = new Set(merged.systems.map((s) => `${s.position.x},${s.position.y}`));
    expect(spots.size).toBe(merged.systems.length);
  });

  it('never lets a map that only added an object blank what another map set on it', async () => {
    const { jita, perimeter } = SYSTEMS;
    // Corp A scouts Jita and Perimeter and marks the gate between them...
    for (const id of [jita, perimeter]) await env.systems.add(alice, corpA.id, { solarSystemId: id });
    await env.systems.update(alice, corpA.id, jita, {
      status: 'hostile',
      description: 'Keepstar',
      temporaryName: 'A1',
      customLabel: 'bait',
      customName: 'Trade hub',
    });
    const gate = await env.connections.add(alice, corpA.id, { source: jita, target: perimeter });
    await env.connections.update(alice, corpA.id, gate.id, {
      massStatus: 'critical',
      timeStatus: 'eol',
      dangerous: true,
      note: 'camped',
      lifetime: '4h',
    });
    await env.signatures.add(alice, corpA.id, jita, { eveId: 'ABC-123', group: 'relic', name: 'Ruins' });
    // ... and Corp B adds the same ones later, touching nothing.
    env.clock.advance(60_000);
    for (const id of [jita, perimeter]) await env.systems.add(bob, corpB.id, { solarSystemId: id });
    await env.connections.add(bob, corpB.id, { source: jita, target: perimeter });
    await env.signatures.add(bob, corpB.id, jita, { eveId: 'ABC-123' });
    const all = [...shareScope.options];
    await share(corpA, alice, 'read', all);
    await share(corpB, bob, 'read', all);

    const merged = await view(alliance.id);
    expect(merged.systems.find((s) => s.solarSystemId === jita)).toMatchObject({
      status: 'hostile',
      description: 'Keepstar',
      temporaryName: 'A1',
      customLabel: 'bait',
      customName: 'Trade hub',
    });
    expect(edge(merged.connections, jita, perimeter)).toMatchObject({
      massStatus: 'critical',
      timeStatus: 'eol',
      dangerous: true,
      note: 'camped',
      lifetime: { mark: '4h' },
    });
    expect(merged.signatures.find((s) => s.eveId === 'ABC-123')).toMatchObject({
      group: 'relic',
      name: 'Ruins',
    });

    // A value Corp B does set, later, still wins.
    env.clock.advance(1_000);
    await env.systems.update(bob, corpB.id, jita, { status: 'friendly', description: 'Keepstar down' });
    await env.settle();
    expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === jita)).toMatchObject({
      status: 'friendly',
      description: 'Keepstar down',
    });
  });

  it('follows changes on a source live, on the composite stream with its own seq', async () => {
    await share(corpA, alice, 'read');
    const head = await env.ports.events.headSeq(mapStream(alliance.id));
    const aEdge = (await env.ports.connections.findBetween(corpA.id, c2, c5))!;
    env.clock.advance(5_000);
    await env.connections.update(alice, corpA.id, aEdge.id, { timeStatus: 'eol' });
    await env.settle();
    const since = await env.events(alliance.id, head);
    expect(since).toHaveLength(1);
    expect(since[0]).toMatchObject({
      type: 'connection.updated',
      seq: head + 1,
      actor: { kind: 'system', id: 'sharing' },
      data: { timeStatus: 'eol', id: `c:${Math.min(c2, c5)}-${Math.max(c2, c5)}` },
    });
    // A new system on the source shows on the composite.
    await env.systems.add(alice, corpA.id, { solarSystemId: shattered });
    await env.settle();
    expect(types(await env.events(alliance.id, head + 1))).toEqual(['system.added']);
  });

  it('writes through read-write shares only, recorded at the source as made via the composite', async () => {
    await share(corpA, alice, 'read-write');
    await share(corpB, bob, 'read');
    const merged = await view(alliance.id);
    const overlap = edge(merged.connections, c5, c1)!;
    expect(overlap.provenance!.writable).toBe(true);

    // Dave edits the alliance chain only; Corp A takes the change, Corp B (read) keeps its own.
    env.clock.advance(10_000);
    await env.writes.updateConnection(dave, alliance.id, overlap.id, {
      massStatus: 'fresh',
      dangerous: true,
    });
    await env.settle();
    const inA = (await env.ports.connections.findBetween(corpA.id, c5, c1))!;
    const inB = (await env.ports.connections.findBetween(corpB.id, c5, c1))!;
    expect(inA).toMatchObject({ massStatus: 'fresh', dangerous: true });
    expect(inB).toMatchObject({ massStatus: 'critical', dangerous: false });
    expect(edge((await view(alliance.id)).connections, c5, c1)).toMatchObject({
      massStatus: 'fresh',
      dangerous: true,
    });

    const [written] = (await env.events(corpA.id)).filter((e) => e.type === 'connection.updated').slice(-1);
    expect(written!.actor).toEqual({ kind: 'account', id: 'dave' });
    const audit = await t.db
      .db<{ event_log: { id: string; audit: string } }>()
      .selectFrom('event_log')
      .select('audit')
      .where('id', '=', written!.id)
      .executeTakeFirstOrThrow();
    expect(JSON.parse(audit.audit)).toMatchObject({ via: { mapId: alliance.id, name: 'Alliance chain' } });

    // Only Corp B (read) holds C1 - shattered: not editable here, and viewers cannot edit at all.
    const onlyB = edge(merged.connections, c1, shattered)!;
    expect(onlyB.provenance!.writable).toBe(false);
    await expect(
      env.writes.updateConnection(dave, alliance.id, onlyB.id, { dangerous: true }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      env.writes.updateConnection(vic, alliance.id, overlap.id, { dangerous: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Deleting on the composite deletes from the read-write source; its newer deletion hides B's older copy too.
    env.clock.advance(1_000);
    await env.writes.removeConnection(dave, alliance.id, overlap.id);
    await env.settle();
    expect(await env.ports.connections.findBetween(corpA.id, c5, c1)).toBeNull();
    expect(await env.ports.connections.findBetween(corpB.id, c5, c1)).not.toBeNull();
    expect(edge((await view(alliance.id)).connections, c5, c1)).toBeUndefined();
  });

  it('keeps a connection field cleared on the composite cleared over a read-only source’s value', async () => {
    // Corp B (read) marks C5 - C1; Corp A (read-write) never did.
    const inB = (await env.ports.connections.findBetween(corpB.id, c5, c1))!;
    env.clock.advance(1_000);
    await env.connections.update(bob, corpB.id, inB.id, { note: 'camped', dangerous: true, lifetime: '4h' });
    const all = [...shareScope.options];
    await share(corpA, alice, 'read-write', all);
    await share(corpB, bob, 'read', all);
    const overlap = async () => edge((await view(alliance.id)).connections, c5, c1)!;
    expect(await overlap()).toMatchObject({ note: 'camped', dangerous: true, lifetime: { mark: '4h' } });

    // Cleared on the composite: only Corp A takes it, and already holds the empty values.
    env.clock.advance(1_000);
    await env.writes.updateConnection(dave, alliance.id, (await overlap()).id, {
      note: '',
      dangerous: false,
      lifetime: null,
    });
    await env.settle();
    const cleared = await overlap();
    expect(cleared).toMatchObject({ dangerous: false });
    expect(cleared.note ?? '').toBe('');
    expect(cleared.lifetime ?? null).toBeNull();
    await env.merger.rebuild(alliance.id);
    expect((await overlap()).note ?? '').toBe('');
    expect((await env.ports.connections.findBetween(corpB.id, c5, c1))!).toMatchObject({ note: 'camped' });
  });

  it('adds new objects to the composite’s first read-write source, and moves only its own layout', async () => {
    await share(corpB, bob, 'read');
    await expect(
      env.writes.addConnection(dave, alliance.id, { source: c2, target: shattered }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await share(corpA, alice, 'read-write');
    await env.writes.addConnection(dave, alliance.id, { source: c2, target: shattered });
    await env.settle();
    // Corp A holds C2, so it gets the connection and the system it lacked; Corp B (read) does not.
    expect(await env.ports.connections.findBetween(corpA.id, c2, shattered)).not.toBeNull();
    expect(await env.ports.connections.findBetween(corpB.id, c2, shattered)).toBeNull();
    expect(edge((await view(alliance.id)).connections, c2, shattered)).toBeDefined();

    const before = (await env.ports.systems.find(corpA.id, c2))!.position;
    await env.writes.moveSystems(dave, alliance.id, { positions: [{ solarSystemId: c2, x: -999, y: 42 }] });
    expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c2)!.position).toEqual({
      x: -999,
      y: 42,
    });
    expect((await env.ports.systems.find(corpA.id, c2))!.position).toEqual(before);
  });

  it('drops a revoked source from the view at once, keeping what other sources hold', async () => {
    const a = await share(corpA, alice, 'read');
    await share(corpB, bob, 'read');
    const head = await env.ports.events.headSeq(mapStream(alliance.id));
    await env.sharing.revoke(alice, corpA.id, a.id);
    const after = await view(alliance.id);
    expect(after.systems.map((s) => s.solarSystemId).sort()).toEqual([c5, c1, shattered].sort());
    expect(edge(after.connections, c2, c5)).toBeUndefined();
    expect(edge(after.connections, c5, c1)).toMatchObject({ massStatus: 'critical' });
    expect(types(await env.events(alliance.id, head))).toEqual([
      'map.share.revoked',
      'connection.removed',
      'system.removed',
      'system.updated',
      'system.updated',
      'connection.updated',
      'map.sources_changed',
    ]);
    // Hiding a share works the same and can be undone.
    const b = (await env.sharing.list(carol, alliance.id)).incoming[0]!;
    await env.sharing.update(carol, alliance.id, b.id, { hidden: true });
    expect((await view(alliance.id)).systems).toEqual([]);
    await env.sharing.update(carol, alliance.id, b.id, { hidden: false });
    expect((await view(alliance.id)).systems).toHaveLength(3);
  });

  it('keeps a deleted signature deleted against older copies elsewhere', async () => {
    const sigA = await env.signatures.add(alice, corpA.id, c5, { eveId: 'ABC-123', group: 'wormhole' });
    env.clock.advance(1_000);
    await env.signatures.add(bob, corpB.id, c5, { eveId: 'ABC-123', group: 'data' });
    await share(corpA, alice, 'read');
    await share(corpB, bob, 'read');
    const before = (await view(alliance.id)).signatures as SignatureDto[];
    expect(before.filter((s) => s.eveId === 'ABC-123')).toEqual([expect.objectContaining({ group: 'data' })]);
    env.clock.advance(1_000);
    await env.signatures.remove(alice, corpA.id, sigA.id);
    await env.settle();
    expect((await view(alliance.id)).signatures.filter((s) => s.eveId === 'ABC-123')).toEqual([]);
    // B scans it again: back.
    env.clock.advance(1_000);
    const sigB = (await env.ports.signatures.listForSystem(corpB.id, c5))[0]!;
    await env.signatures.update(bob, corpB.id, sigB.id, { name: 'Again' });
    await env.settle();
    expect((await view(alliance.id)).signatures.map((s) => s.name)).toEqual(['Again']);
  });

  it('lets nothing outside the share’s scopes through: snapshot, events, routing input and writes', async () => {
    await env.systems.update(alice, corpA.id, c5, {
      status: 'hostile',
      description: 'Our POS',
      temporaryName: 'A1',
    });
    await env.signatures.add(alice, corpA.id, c5, { eveId: 'XYZ-999', group: 'relic' });
    await share(corpA, alice, 'read-write', ['topology']);
    const merged = await view(alliance.id);
    const system = merged.systems.find((s) => s.solarSystemId === c5) as MapSystemDto;
    expect(system).toMatchObject({
      status: 'unknown',
      description: '',
      temporaryName: null,
      customName: null,
    });
    expect(merged.signatures).toEqual([]);
    expect(edge(merged.connections, c5, c1)).toMatchObject({ massStatus: 'fresh', timeStatus: 'normal' });

    // Nothing of it in the composite's events either.
    const text = JSON.stringify((await env.events(alliance.id)).map((e) => e.data));
    // (The composite's own default Hostile Tag is in its map.created; the status is what matters.)
    expect(text).not.toContain('"status":"hostile"');
    expect(text).not.toContain('Our POS');
    expect(text).not.toContain('XYZ-999');
    expect(text).not.toContain('reduced');

    // Changes outside the scopes on the source stay there.
    const head = await env.ports.events.headSeq(mapStream(alliance.id));
    await env.systems.update(alice, corpA.id, c5, { status: 'friendly' });
    await env.settle();
    expect(await env.events(alliance.id, head)).toEqual([]);

    // Routing reads the same cut chain.
    const chain = await env.ports.overlay!.view(alliance.id);
    expect(JSON.stringify(chain)).not.toContain('reduced');

    // The composite cannot write what it cannot read.
    await expect(env.writes.updateSystem(dave, alliance.id, c5, { status: 'hostile' })).rejects.toMatchObject(
      { code: 'forbidden', message: expect.stringMatching(/system intel/) },
    );
    await expect(
      env.writes.updateConnection(dave, alliance.id, edge(merged.connections, c5, c1)!.id, {
        massStatus: 'critical',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(env.writes.addSignature(dave, alliance.id, c5, { eveId: 'QQQ-111' })).rejects.toMatchObject({
      code: 'forbidden',
    });

    // Widening the offer brings intel in.
    const offered = (await env.sharing.list(alice, corpA.id)).outgoing[0]!;
    await env.sharing.update(alice, corpA.id, offered.id, { scopes: ['topology', 'intel'] });
    expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)).toMatchObject({
      status: 'friendly',
      description: 'Our POS',
      temporaryName: null,
    });
  });

  it('shares Labels by name and the custom label with the labels scope only, and writes them back by name', async () => {
    await env.systems.update(alice, corpA.id, c5, { systemLabelIds: ['wh1'], customLabel: 'bait' });
    // The alliance names its Labels its own way: WH1 matches by name, B is its own.
    await env.maps.setSystemLabels(carol, alliance.id, [
      { id: 'al-1', name: 'wh1', description: '' },
      { id: 'al-b', name: 'B', description: '' },
    ]);
    await share(corpA, alice, 'read-write', ['topology']);
    const c5Of = async () => (await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)!;
    expect(await c5Of()).toMatchObject({ systemLabelIds: [], customLabel: null });
    expect(JSON.stringify((await env.events(alliance.id)).map((e) => e.data))).not.toContain('bait');
    await expect(
      env.writes.updateSystem(dave, alliance.id, c5, { customLabel: 'scout' }),
    ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(/labels/) });

    const offered = (await env.sharing.list(alice, corpA.id)).outgoing[0]!;
    await env.sharing.update(alice, corpA.id, offered.id, { scopes: ['topology', 'labels'] });
    await env.settle();
    expect(await c5Of()).toMatchObject({ systemLabelIds: ['al-1'], customLabel: 'bait' });

    // Written back by name: Corp A has no B, so only WH1 stays on there.
    env.clock.advance(1_000);
    await env.writes.updateSystem(dave, alliance.id, c5, {
      systemLabelIds: ['al-b', 'al-1'],
      customLabel: 'scout',
    });
    await env.settle();
    expect(await env.ports.systems.find(corpA.id, c5)).toMatchObject({
      systemLabelIds: ['wh1'],
      customLabel: 'scout',
    });
    expect(await c5Of()).toMatchObject({ systemLabelIds: ['al-1'], customLabel: 'scout' });

    // Corp A renames its WH1: the alliance has no Label of that name, so it shows none.
    await env.maps.setSystemLabels(alice, corpA.id, [{ id: 'wh1', name: 'X', description: '' }]);
    await env.settle();
    expect(await c5Of()).toMatchObject({ systemLabelIds: [], customLabel: 'scout' });
  });

  it('shares tracked characters only with the characters scope', async () => {
    env.tracked.set(corpA.id, [
      {
        characterId: 95000001,
        accountId: 'alice',
        name: 'Scout',
        solarSystemId: c5,
        shipTypeId: 670,
        shipName: null,
        online: true,
        updatedAt: 5,
      },
    ]);
    const a = await share(corpA, alice, 'read');
    expect(await env.merger.snapshot(alliance.id)).toMatchObject({ characters: [] });
    await env.sharing.update(alice, corpA.id, a.id, { scopes: ['topology', 'characters'] });
    const { characters } = (await env.merger.snapshot(alliance.id)) as {
      characters: Array<Record<string, unknown>>;
    };
    // The source's account is not handed out: it belongs to that map's instance.
    expect(characters).toEqual([
      expect.objectContaining({ characterId: 95000001, name: 'Scout', accountId: 'shared' }),
    ]);
  });

  it('merges shared maps into a map of its own, and goes back to its own objects when the last share ends', async () => {
    const offered = await env.sharing.offer(bob, corpB.id, { targetMapId: corpA.id, level: 'read' });
    await env.sharing.accept(alice, corpA.id, offered.id, {});
    await env.settle();
    const merged = await view(corpA.id, alice);
    expect(merged.sources!.map((s) => s.name)).toEqual(['Corp A', 'Corp B']);
    expect(merged.systems.map((s) => s.solarSystemId).sort()).toEqual([c2, c5, c1, shattered].sort());
    // Its own systems keep their places.
    const own = (await env.ports.systems.find(corpA.id, c2))!;
    expect(merged.systems.find((s) => s.solarSystemId === c2)!.position).toEqual(own.position);

    // Edits of its own objects reach its merged view.
    const head = await env.ports.events.headSeq(mapStream(corpA.id));
    await env.systems.update(alice, corpA.id, c2, { status: 'home' });
    await env.settle();
    const since = await env.events(corpA.id, head);
    expect(types(since)).toEqual(['system.updated', 'system.updated']);
    // A copy: the map's webhooks and plugins already heard the change from its own event.
    expect(since[1]).toMatchObject({
      actor: { kind: 'system', id: 'sharing-copy' },
      data: { status: 'home' },
    });

    await env.sharing.revoke(alice, corpA.id, offered.id);
    expect(await env.merger.isMerged(corpA.id)).toBe(false);
    const last = (await env.events(corpA.id)).at(-1)!;
    expect(last).toMatchObject({ type: 'map.sources_changed', data: { sources: [] } });
    expect(
      (await env.snapshots.snapshot(alice, corpA.id)).systems.map((s) => s.solarSystemId).sort(),
    ).toEqual([c2, c5, c1].sort());
  });

  it('builds a merged map again from scratch, publishing only what was missed', async () => {
    await share(corpA, alice, 'read');
    const head = await env.ports.events.headSeq(mapStream(alliance.id));
    // A restart: nothing in memory, and a change the merge never heard of.
    const fresh = sharingTestEnv(t.db);
    const aEdge = (await env.ports.connections.findBetween(corpA.id, c2, c5))!;
    await env.ports.connections.update({ ...aEdge, dangerous: true, updatedAt: env.clock.now() + 1 });
    await fresh.merger.rebuildAll();
    expect(types(await env.events(alliance.id, head))).toEqual(['connection.updated']);
    await fresh.merger.rebuildAll();
    expect(types(await env.events(alliance.id, head))).toEqual(['connection.updated']);
  });

  it('hides a deleted map from the maps that merge it and forgets its shares once purged', async () => {
    await share(corpA, alice, 'read');
    const merged = (await view(alliance.id)).systems.length;
    expect(merged).toBeGreaterThan(0);
    await env.maps.remove(alice, corpA.id);
    await env.settle();
    expect((await view(alliance.id)).systems).toEqual([]);
    // Restorable: the share stays until the map is purged.
    expect((await env.sharing.list(carol, alliance.id)).incoming).toHaveLength(1);
    const admin = { kind: 'account' as const, id: 'root', instanceRole: 'admin' as const };
    await env.maps.restore(admin, corpA.id);
    await env.settle();
    expect((await view(alliance.id)).systems).toHaveLength(merged);
    await env.maps.adminTrash(admin, corpA.id);
    await env.maps.purge(admin, corpA.id);
    await env.settle();
    expect((await view(alliance.id)).systems).toEqual([]);
    expect((await env.sharing.list(carol, alliance.id)).incoming).toEqual([]);
  });

  it('keeps a composite’s own notes, labels and locks over what its sources say', async () => {
    await env.systems.update(alice, corpA.id, c5, { description: 'Corp A notes' });
    await share(corpA, alice, 'read', ['topology', 'intel']);
    const before = (await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)!;
    expect(before.description).toBe('Corp A notes');
    // Even on a read-only source's system: these live on the composite. Locks are for managers.
    await expect(env.writes.updateSystem(dave, alliance.id, c5, { locked: true })).rejects.toMatchObject({
      code: 'forbidden',
    });
    env.access.grant('dave', alliance.id, 'manager');
    await env.writes.updateSystem(dave, alliance.id, c5, { description: 'Alliance notes', locked: true });
    const after = (await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)!;
    expect(after).toMatchObject({ description: 'Alliance notes', locked: true });
    expect((await env.ports.systems.find(corpA.id, c5))!.description).toBe('Corp A notes');
    await expect(
      env.writes.moveSystems(dave, alliance.id, { positions: [{ solarSystemId: c5, x: 1, y: 1 }] }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(env.writes.removeSystem(dave, alliance.id, c5)).rejects.toMatchObject({ code: 'conflict' });
    // A source changing its notes no longer shows over the composite's.
    env.clock.advance(1_000);
    await env.systems.update(alice, corpA.id, c5, { description: 'Corp A again' });
    await env.settle();
    expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)!.description).toBe(
      'Alliance notes',
    );
    // Survives a rebuild from scratch.
    await sharingTestEnv(t.db).merger.rebuildAll();
    expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)!.locked).toBe(true);
  });

  describe('locks held by a source', () => {
    const system = async (id: number) =>
      (await view(alliance.id)).systems.find((s) => s.solarSystemId === id)!;

    it('shows the source’s lock on the composite, in snapshots and live events', async () => {
      await env.systems.update(alice, corpA.id, c5, { locked: true });
      const a = await share(corpA, alice, 'read-write');
      expect(await system(c5)).toMatchObject({
        locked: true,
        lockedBy: 'source',
        lockedOn: [{ sourceId: a.id, name: 'Corp A' }],
      });
      const open = await system(c2);
      expect(open.locked).toBe(false);
      expect(open).not.toHaveProperty('lockedBy');

      // A lock set on the source later reaches the composite's viewers as an update.
      const head = await env.ports.events.headSeq(mapStream(alliance.id));
      await env.systems.update(alice, corpA.id, c2, { locked: true });
      await env.settle();
      const updates = (await env.events(alliance.id, head)).filter((e) => e.type === 'system.updated');
      expect(updates.map((e) => e.data)).toEqual([
        expect.objectContaining({ solarSystemId: c2, locked: true, lockedBy: 'source' }),
      ]);
      // And survives a rebuild from scratch.
      await sharingTestEnv(t.db).merger.rebuildAll();
      expect(await system(c2)).toMatchObject({ locked: true, lockedBy: 'source' });
    });

    it('refuses moving and removing it with a message naming the map holding the lock', async () => {
      await env.systems.update(alice, corpA.id, c5, { locked: true });
      await share(corpA, alice, 'read-write', ['topology', 'labels']);
      const refusal = { code: 'conflict', message: expect.stringMatching(/locked on Corp A/) };
      await expect(env.writes.removeSystem(dave, alliance.id, c5)).rejects.toMatchObject(refusal);
      await expect(env.writes.updateSystem(dave, alliance.id, c5, { visible: false })).rejects.toMatchObject(
        refusal,
      );
      await expect(
        env.writes.moveSystems(dave, alliance.id, { positions: [{ solarSystemId: c5, x: 9, y: 9 }] }),
      ).rejects.toMatchObject(refusal);
      expect((await env.ports.systems.find(corpA.id, c5))!.visible).toBe(true);
      // Its other fields still go through.
      await env.writes.updateSystem(dave, alliance.id, c5, { customLabel: 'bait' });
      expect((await env.ports.systems.find(corpA.id, c5))!.customLabel).toBe('bait');
    });

    it('is unlocked there by a manager of the source, audited on the source; refused to anyone else', async () => {
      await env.systems.update(alice, corpA.id, c5, { locked: true });
      // Read-only: the lock is still the source's managers' to lift.
      await share(corpA, alice, 'read');
      const refusal = { code: 'forbidden', message: expect.stringMatching(/only a manager of Corp A/) };
      // Neither a member nor the composite's own admin manage Corp A.
      await expect(env.writes.updateSystem(dave, alliance.id, c5, { locked: false })).rejects.toMatchObject(
        refusal,
      );
      await expect(env.writes.updateSystem(carol, alliance.id, c5, { locked: false })).rejects.toMatchObject(
        refusal,
      );
      expect((await env.ports.systems.find(corpA.id, c5))!.locked).toBe(true);

      env.access.grant('dave', corpA.id, 'manager');
      env.clock.advance(1_000);
      await env.writes.updateSystem(dave, alliance.id, c5, { locked: false });
      await env.settle();
      expect((await env.ports.systems.find(corpA.id, c5))!.locked).toBe(false);
      const open = await system(c5);
      expect(open.locked).toBe(false);
      expect(open).not.toHaveProperty('lockedOn');

      const [written] = (await env.events(corpA.id)).filter((e) => e.type === 'system.updated').slice(-1);
      expect(written).toMatchObject({ actor: { kind: 'account', id: 'dave' }, data: { locked: false } });
      const audit = await t.db
        .db<{ event_log: { id: string; audit: string } }>()
        .selectFrom('event_log')
        .select('audit')
        .where('id', '=', written!.id)
        .executeTakeFirstOrThrow();
      expect(JSON.parse(audit.audit)).toMatchObject({ via: { mapId: alliance.id, name: 'Alliance chain' } });
      // Nothing was kept on the composite itself.
      expect((await env.sharingPorts.local.list(alliance.id)).get(c5)?.locked ?? false).toBe(false);
    });

    it('keeps the composite’s own lock apart from the source’s: unlocking lifts its own first', async () => {
      await share(corpA, alice, 'read-write');
      await env.writes.updateSystem(carol, alliance.id, c5, { locked: true });
      expect(await system(c5)).toMatchObject({ locked: true, lockedBy: 'here' });
      expect(await system(c5)).not.toHaveProperty('lockedOn');
      await env.systems.update(alice, corpA.id, c5, { locked: true });
      await env.settle();
      expect(await system(c5)).toMatchObject({ lockedBy: 'here', lockedOn: [{ name: 'Corp A' }] });
      // Carol manages the composite, not Corp A: her unlock lifts the composite's lock only.
      await env.writes.updateSystem(carol, alliance.id, c5, { locked: false });
      expect(await system(c5)).toMatchObject({ locked: true, lockedBy: 'source' });
      expect((await env.ports.systems.find(corpA.id, c5))!.locked).toBe(true);
    });

    it('holds connections locked on the source for that map’s managers', async () => {
      const ab = (await env.ports.connections.findBetween(corpA.id, c5, c1))!;
      await env.connections.update(alice, corpA.id, ab.id, { locked: true });
      await share(corpA, alice, 'read-write');
      const merged = edge((await view(alliance.id)).connections, c5, c1)!;
      expect(merged).toMatchObject({ locked: true, lockedBy: 'source', lockedOn: [{ name: 'Corp A' }] });
      const refusal = { code: 'forbidden', message: expect.stringMatching(/locked on Corp A/) };
      await expect(
        env.writes.updateConnection(dave, alliance.id, merged.id, { dangerous: true }),
      ).rejects.toMatchObject(refusal);
      await expect(env.writes.removeConnection(dave, alliance.id, merged.id)).rejects.toMatchObject(refusal);
      await expect(env.writes.removeSystem(dave, alliance.id, c1)).rejects.toMatchObject({
        code: 'forbidden',
        message: expect.stringMatching(/connection locked on Corp A/),
      });
      await expect(
        env.writes.updateConnection(dave, alliance.id, merged.id, { locked: false }),
      ).rejects.toMatchObject(refusal);

      env.access.grant('dave', corpA.id, 'manager');
      await env.writes.updateConnection(dave, alliance.id, merged.id, { locked: false });
      await env.settle();
      expect((await env.ports.connections.findBetween(corpA.id, c5, c1))!.locked ?? false).toBe(false);
      expect(edge((await view(alliance.id)).connections, c5, c1)).not.toHaveProperty('locked');
      // Locking on a composite locks it on the sources taking writes, for their managers.
      await env.writes.updateConnection(dave, alliance.id, merged.id, { locked: true });
      await env.settle();
      expect((await env.ports.connections.findBetween(corpA.id, c5, c1))!.locked).toBe(true);
    });
  });

  it('sends a composite’s new systems to the source its admins picked', async () => {
    env.access.grant('bob', alliance.id, 'admin');
    await share(corpA, alice, 'read-write');
    const b = await env.sharing.offer(bob, corpB.id, { targetMapId: alliance.id, level: 'read-write' });
    await env.settle();
    await env.writes.addSystem(dave, alliance.id, { solarSystemId: SYSTEMS.jita });
    await env.settle();
    expect(await env.ports.systems.find(corpA.id, SYSTEMS.jita)).not.toBeNull();
    await env.sharing.update(carol, alliance.id, b.id, { defaultWrite: true });
    await env.writes.addSystem(dave, alliance.id, { solarSystemId: SYSTEMS.perimeter });
    await env.settle();
    expect(await env.ports.systems.find(corpB.id, SYSTEMS.perimeter)).not.toBeNull();
    expect(await env.ports.systems.find(corpA.id, SYSTEMS.perimeter)).toBeNull();
    const incoming = (await env.sharing.list(carol, alliance.id)).incoming;
    expect(incoming.filter((s) => s.defaultWrite).map((s) => s.sourceName)).toEqual(['Corp B']);
  });

  it('asks the target again before a read share takes writes', async () => {
    const a = await share(corpA, alice, 'read');
    const raised = await env.sharing.update(alice, corpA.id, a.id, { level: 'read-write' });
    expect(raised).toMatchObject({ level: 'read', offeredLevel: 'read-write' });
    const overlap = edge((await view(alliance.id)).connections, c5, c1)!;
    await expect(
      env.writes.updateConnection(dave, alliance.id, overlap.id, { dangerous: true }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await env.sharing.accept(carol, alliance.id, a.id, {});
    await env.writes.updateConnection(dave, alliance.id, overlap.id, { dangerous: true });
    expect((await env.ports.connections.findBetween(corpA.id, c5, c1))!.dangerous).toBe(true);
  });

  it('forgets old deletions', async () => {
    await env.ports.stamps.putTombstone(corpA.id, 'signature', `${c5}:ABC-123`, 1_000);
    await env.ports.stamps.putTombstone(corpA.id, 'signature', `${c5}:ABC-124`, 50_000);
    expect(await env.ports.stamps.pruneTombstones(10_000)).toBe(1);
    expect([...(await env.ports.stamps.tombstones(corpA.id, 'signature')).keys()]).toEqual([`${c5}:ABC-124`]);
  });

  it('numbers a merged map’s wormholes in its order as shown, not by hand', async () => {
    await share(corpA, alice, 'read');
    const numbers = new BookmarkNumberUseCases(env.ports);
    await expect(numbers.renumber(carol, alliance.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses edits of the composite’s own rows through the plain map routes', async () => {
    await expect(env.systems.add(carol, alliance.id, { solarSystemId: c2 })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  describe('intel kept on hidden systems', () => {
    const { jita } = SYSTEMS;
    const all = [...shareScope.options];

    /** Corp B keeps intel on C2 and Jita, both hidden: its intel library. */
    beforeEach(async () => {
      for (const id of [c2, jita]) {
        await env.systems.add(bob, corpB.id, { solarSystemId: id });
        await env.systems.update(bob, corpB.id, id, {
          status: 'hostile',
          description: `B intel on ${id}`,
          customName: 'Their staging',
          temporaryName: 'B7',
        });
        await env.signatures.add(bob, corpB.id, id, { eveId: 'HID-001', group: 'relic', name: 'Ruins' });
        await env.systems.remove(bob, corpB.id, id);
      }
      await env.settle();
    });

    it('lends a hidden system’s intel and signatures to the system another source shows', async () => {
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read', all);
      const merged = await view(alliance.id);
      const shown = merged.systems.find((s) => s.solarSystemId === c2)!;
      expect(shown).toMatchObject({
        status: 'hostile',
        description: `B intel on ${c2}`,
        customName: 'Their staging',
        temporaryName: 'B7',
      });
      // Corp B does not show it: changes go to Corp A only, and its own place is Corp A's.
      const [, a, b] = merged.sources!;
      expect(shown.provenance).toMatchObject({ sources: [a!.id], updatedBy: b!.id, writable: true });
      expect(merged.signatures.find((s) => s.solarSystemId === c2)).toMatchObject({
        eveId: 'HID-001',
        group: 'relic',
        name: 'Ruins',
      });
      // A newer note on the composite's writable source wins over the kept one, field by field.
      env.clock.advance(1_000);
      await env.writes.updateSystem(dave, alliance.id, c2, { status: 'friendly' });
      await env.settle();
      expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c2)).toMatchObject({
        status: 'friendly',
        description: `B intel on ${c2}`,
      });
      expect((await env.ports.systems.find(corpB.id, c2))!.status).toBe('hostile');
      // The kept signature is Corp B's alone: it is not changed through a map that hides it.
      await expect(
        env.writes.updateSignature(dave, alliance.id, `s:${c2}:HID-001`, { name: 'Gone' }),
      ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(/Corp B/) });
    });

    it('keeps what is cleared on the composite cleared, though a hidden copy still holds a value', async () => {
      const { perimeter } = SYSTEMS;
      await env.maps.setSystemLabels(bob, corpB.id, [{ id: 'b-stg', name: 'Staging', description: '' }]);
      await env.maps.setSystemLabels(carol, alliance.id, [
        { id: 'al-stg', name: 'Staging', description: '' },
      ]);
      // Corp B keeps Perimeter hidden as an import leaves it: values without field times, so they
      // count from when the row was made ...
      const born = env.clock.now();
      await env.ports.systems.insert({
        mapId: corpB.id,
        solarSystemId: perimeter,
        position: { x: 0, y: 0 },
        customName: 'Graniczny, Jita 5',
        temporaryName: 'B9',
        tag: 'HQ',
        status: 'hostile',
        description: 'B intel',
        labelIds: [],
        systemLabelIds: ['b-stg'],
        customLabel: 'S',
        locked: false,
        visible: false,
        createdAt: born,
        updatedAt: born,
      });
      // ... and Corp A, the only map showing it, has nothing set on it.
      env.clock.advance(1_000);
      await env.systems.add(alice, corpA.id, { solarSystemId: perimeter });
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read-write', all);
      const shown = async () => (await view(alliance.id)).systems.find((s) => s.solarSystemId === perimeter)!;
      expect(await shown()).toMatchObject({
        customName: 'Graniczny, Jita 5',
        temporaryName: 'B9',
        tag: 'HQ',
        status: 'hostile',
        description: 'B intel',
        systemLabelIds: ['al-stg'],
        customLabel: 'S',
      });
      // A plain edit that changes nothing stamps nothing.
      const timesOfA = async () =>
        (await env.ports.stamps.fieldTimes(corpA.id, 'system', [String(perimeter)])).get(String(perimeter));
      const untouched = await timesOfA();
      await env.systems.update(alice, corpA.id, perimeter, { customName: null, customLabel: null });
      expect(await timesOfA()).toEqual(untouched);

      // Cleared on the composite: Corp A already holds the empty values, yet takes them as written now.
      env.clock.advance(1_000);
      const cleared = {
        customName: null,
        temporaryName: null,
        tag: null,
        status: 'unknown' as const,
        description: '',
        systemLabelIds: [],
        customLabel: null,
      };
      await env.writes.updateSystem(dave, alliance.id, perimeter, cleared);
      await env.settle();
      expect(await shown()).toMatchObject(cleared);
      expect(await timesOfA()).toMatchObject({ customName: env.clock.now(), customLabel: env.clock.now() });
      // Corp B's hidden copy takes no writes; it stays cleared when the sources are read again.
      expect(await env.ports.systems.find(corpB.id, perimeter)).toMatchObject({
        customName: 'Graniczny, Jita 5',
        customLabel: 'S',
      });
      await env.merger.rebuild(alliance.id);
      expect(await shown()).toMatchObject(cleared);
    });

    it('keeps a signature field cleared on the composite cleared over the copy in a hidden system', async () => {
      // Corp A shows C2 with the same signature, nothing known about it; Corp B's hidden C2 names it.
      env.clock.advance(1_000);
      await env.signatures.add(alice, corpA.id, c2, { eveId: 'HID-001' });
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read', all);
      const signature = async () =>
        (await view(alliance.id)).signatures.find((s) => s.solarSystemId === c2 && s.eveId === 'HID-001')!;
      expect(await signature()).toMatchObject({ group: 'relic', name: 'Ruins' });

      env.clock.advance(1_000);
      await env.writes.updateSignature(dave, alliance.id, (await signature()).id, { name: null });
      await env.settle();
      expect(await signature()).toMatchObject({ group: 'relic', name: null });
      await env.merger.rebuild(alliance.id);
      expect(await signature()).toMatchObject({ name: null });
      expect((await env.ports.signatures.listForSystem(corpB.id, c2))[0]).toMatchObject({ name: 'Ruins' });
    });

    it('never shows a system only hidden copies hold, nor publishes anything about it', async () => {
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read', all);
      const merged = await view(alliance.id);
      expect(merged.systems.map((s) => s.solarSystemId)).not.toContain(jita);
      expect(merged.signatures.filter((s) => s.solarSystemId === jita)).toEqual([]);
      expect(JSON.stringify((await env.events(alliance.id)).map((e) => e.data))).not.toContain(
        `B intel on ${jita}`,
      );
      // When the source that showed C2 hides it too, it leaves the composite with its intel kept.
      await env.systems.remove(alice, corpA.id, c2);
      await env.settle();
      expect((await view(alliance.id)).systems.map((s) => s.solarSystemId)).not.toContain(c2);
      // ... and comes back with it, as a hidden system does on a map of its own.
      await env.systems.add(alice, corpA.id, { solarSystemId: c2 });
      await env.settle();
      expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c2)).toMatchObject({
        description: `B intel on ${c2}`,
      });
    });

    it('follows an import that changed a hidden system’s intel silently', async () => {
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read', all);
      // A Wanderer pull writes the hidden system without publishing anything about it...
      const kept = (await env.ports.systems.find(corpB.id, c2))!;
      env.clock.advance(5_000);
      await env.ports.systems.update({
        ...kept,
        description: 'Fresh from Wanderer',
        updatedAt: env.clock.now(),
      });
      // ... and says it finished.
      await env.ports.events.append([
        newEvent({
          stream: mapStream(corpB.id),
          type: 'import.finished',
          actor: { kind: 'system', id: 'importing' },
          data: {
            jobId: 'job',
            source: { kind: 'wanderer-api', host: 'wanderer.example', slug: 'b', name: null },
            status: 'done',
            outcome: { systems: { created: 0, updated: 1, unchanged: 0, skipped: 0, removed: 0 } },
            error: null,
          },
          occurredAt: env.clock.now(),
        }),
      ]);
      await env.settle();
      expect((await view(alliance.id)).systems.find((s) => s.solarSystemId === c2)).toMatchObject({
        description: 'Fresh from Wanderer',
      });
    });

    it('shares no intel of hidden systems without the scopes for it', async () => {
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read', ['topology', 'signatures']);
      const merged = await view(alliance.id);
      expect(merged.systems.find((s) => s.solarSystemId === c2)).toMatchObject({
        status: 'unknown',
        description: '',
        customName: null,
        temporaryName: null,
      });
      expect(merged.signatures.find((s) => s.solarSystemId === c2)).toMatchObject({ eveId: 'HID-001' });
      expect(JSON.stringify((await env.events(alliance.id)).map((e) => e.data))).not.toContain('B intel');

      // Topology alone: nothing of Corp B's hidden systems reaches the composite at all.
      const offered = (await env.sharing.list(bob, corpB.id)).outgoing[0]!;
      await env.sharing.update(bob, corpB.id, offered.id, { scopes: ['topology'] });
      await env.settle();
      const state = (await env.merger.state(alliance.id))!;
      expect(state.merge.keepers(`system|${c2}`)).toEqual([]);
      expect((await view(alliance.id)).signatures.filter((s) => s.solarSystemId === c2)).toEqual([]);
    });

    it('brings a hidden system’s intel along when it is added on the composite', async () => {
      await share(corpA, alice, 'read-write', all);
      await share(corpB, bob, 'read', all);
      await env.writes.addSystem(dave, alliance.id, { solarSystemId: jita, position: { x: 2400, y: 480 } });
      await env.settle();
      // Added to Corp A (the composite's writable source); Corp B still keeps it hidden.
      expect((await env.ports.systems.find(corpA.id, jita))!.visible).toBe(true);
      expect((await env.ports.systems.find(corpB.id, jita))!.visible).toBe(false);
      const merged = await view(alliance.id);
      expect(merged.systems.find((s) => s.solarSystemId === jita)).toMatchObject({
        position: { x: 2400, y: 480 },
        status: 'hostile',
        description: `B intel on ${jita}`,
      });
      expect(merged.signatures.find((s) => s.solarSystemId === jita)).toMatchObject({ name: 'Ruins' });
    });
  });

  describe('layout of sources in different coordinate spaces', () => {
    const { jita, perimeter } = SYSTEMS;
    let corpC: ChainMap;
    const at = async (id: number) =>
      (await view(alliance.id)).systems.find((s) => s.solarSystemId === id)!.position;

    /** Corp C maps a chain of its own far left of where Corp A has its chain. */
    beforeEach(async () => {
      corpC = await env.maps.create(bob, { name: 'Corp C' });
      await env.systems.add(bob, corpC.id, { solarSystemId: jita, position: { x: -3504, y: -2496 } });
      await env.systems.add(bob, corpC.id, { solarSystemId: perimeter, position: { x: -3144, y: -2352 } });
      await env.connections.add(bob, corpC.id, { source: jita, target: perimeter });
      await share(corpA, alice, 'read-write');
      await share(corpC, bob, 'read');
    });

    it('keeps the first source’s places and puts the next cluster beside it, on the grid', async () => {
      const merged = await view(alliance.id);
      const ofA = await Promise.all(
        [c2, c5, c1].map(async (id) => (await env.ports.systems.find(corpA.id, id))!),
      );
      for (const system of ofA) expect(await at(system.solarSystemId)).toEqual(system.position);
      const right = Math.max(...ofA.map((s) => s.position.x));
      const top = Math.min(...ofA.map((s) => s.position.y));
      const j = await at(jita);
      const p = await at(perimeter);
      // Right of Corp A's chain with a free column between, its top on Corp A's top.
      expect(j.x).toBeGreaterThanOrEqual(right + 2 * 360);
      expect(j.y).toBe(top);
      expect(j.x % 24).toBe(0);
      expect(j.y % 24).toBe(0);
      // The cluster keeps its own shape.
      expect({ x: p.x - j.x, y: p.y - j.y }).toEqual({ x: 360, y: 144 });
      const spots = new Set(merged.systems.map((s) => `${s.position.x},${s.position.y}`));
      expect(spots.size).toBe(merged.systems.length);
    });

    it('keeps the offset between rebuilds, so later systems join their cluster', async () => {
      const before = { jita: await at(jita), perimeter: await at(perimeter) };
      const fresh = sharingTestEnv(t.db);
      await fresh.merger.rebuildAll();
      expect(await at(jita)).toEqual(before.jita);
      // A system Corp C adds later lands in Corp C's cluster, where Corp C has it.
      await env.systems.add(bob, corpC.id, { solarSystemId: shattered, position: { x: -3504, y: -1200 } });
      await env.settle();
      expect(await at(shattered)).toEqual({ x: before.jita.x, y: before.jita.y + 1296 });
      // A system moved on the composite stays where it was put.
      await env.writes.moveSystems(dave, alliance.id, {
        positions: [{ solarSystemId: jita, x: 48, y: 960 }],
      });
      await fresh.merger.rebuildAll();
      expect(await at(jita)).toEqual({ x: 48, y: 960 });
    });

    it('moves the clusters of a map laid out before offsets apart once, leaving moved systems', async () => {
      const ownOf = async (mapId: string, id: number) => (await env.ports.systems.find(mapId, id))!.position;
      // As the old rule placed them: every system where its source has it; Corp A's C1 was moved.
      const { layout } = env.sharingPorts;
      await layout.clear(alliance.id);
      await layout.put(
        alliance.id,
        [
          { solarSystemId: c2, position: await ownOf(corpA.id, c2) },
          { solarSystemId: c5, position: await ownOf(corpA.id, c5) },
          { solarSystemId: c1, position: { x: 1200, y: 1200 } },
          { solarSystemId: jita, position: await ownOf(corpC.id, jita) },
          { solarSystemId: perimeter, position: { x: -3144, y: -2352 + 144 } },
        ],
        env.clock.now(),
      );
      const fresh = sharingTestEnv(t.db);
      await fresh.merger.rebuildAll();
      expect(await at(c2)).toEqual(await ownOf(corpA.id, c2));
      expect(await at(c1)).toEqual({ x: 1200, y: 1200 });
      const j = await at(jita);
      expect(j.x).toBeGreaterThanOrEqual(1200 + 2 * 360);
      expect(await at(perimeter)).toEqual({ x: j.x + 360, y: j.y + 288 });
      // Once: the next rebuild changes nothing.
      const head = await env.ports.events.headSeq(mapStream(alliance.id));
      await sharingTestEnv(t.db).merger.rebuildAll();
      expect(await env.events(alliance.id, head)).toEqual([]);
    });
  });
});
