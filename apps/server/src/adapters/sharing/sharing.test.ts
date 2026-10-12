import { afterEach, beforeEach, expect, it } from 'vitest';
import { mapStream, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { BookmarkNumberUseCases, type ChainMap } from '@darkbeacon/mapping';
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
    expect(text).not.toContain('hostile');
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

  it('forgets the shares of a deleted map', async () => {
    await share(corpA, alice, 'read');
    await env.maps.remove(alice, corpA.id);
    await env.settle();
    expect((await view(alliance.id)).systems).toEqual([]);
    expect((await env.sharing.list(carol, alliance.id)).incoming).toEqual([]);
  });

  it('keeps a composite’s own notes, labels and locks over what its sources say', async () => {
    await env.systems.update(alice, corpA.id, c5, { description: 'Corp A notes' });
    await share(corpA, alice, 'read', ['topology', 'intel']);
    const before = (await view(alliance.id)).systems.find((s) => s.solarSystemId === c5)!;
    expect(before.description).toBe('Corp A notes');
    // Even on a read-only source's system: these live on the composite.
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
});
