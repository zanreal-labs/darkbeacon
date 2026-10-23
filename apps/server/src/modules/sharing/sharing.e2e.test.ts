import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  ApiErrorBody,
  AuditPageDto,
  ConnectionDto,
  MapDto,
  MapShareDto,
  MapSnapshot,
  MeDto,
  ServerMessage,
  StreamSnapshotDto,
} from '@darkbeacon/shared';
import WebSocket from 'ws';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const C2 = 31000399; // J130256
const C5 = 31001924; // J130026
const C1 = 31000220; // J121158

type EventMessage = Extract<ServerMessage, { op: 'event' }>;

describeEachDialect('merged chains over HTTP and /ws', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', PUBLIC_URL: 'http://dbk.test', DEMO_MODE: 'true' }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
  });

  const signIn = async (name: string) => {
    const response = await fetch(`http://${base}/api/auth/dev`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split('; ')[0])
      .join('; ');
    const me = (await response.json()) as MeDto;
    const call = async <T = unknown>(method: string, path: string, json?: unknown): Promise<T> => {
      const r = await fetch(`http://${base}${path}`, {
        method,
        headers: { cookie, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
      expect(r.status, `${method} ${path}: ${r.status === 204 ? '' : await r.clone().text()}`).toBeLessThan(
        300,
      );
      const text = await r.text();
      return (text ? JSON.parse(text) : undefined) as T;
    };
    const status = async (method: string, path: string, json?: unknown) =>
      (
        await fetch(`http://${base}${path}`, {
          method,
          headers: { cookie, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        })
      ).status;
    return { me, cookie, call, status };
  };

  const open = async (cookie: string, stream: string, sinceSeq?: number) => {
    const socket = new WebSocket(`ws://${base}/ws`, { headers: { cookie } });
    sockets.push(socket);
    const messages: ServerMessage[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ op: 'subscribe', stream, ...(sinceSeq === undefined ? {} : { sinceSeq }) }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));
    const events = () => messages.filter((m): m is EventMessage => m.op === 'event').map((m) => m.event);
    const lastSeq = () => {
      const subscribed = messages.find((m) => m.op === 'subscribed') as { seq: number };
      return Math.max(subscribed.seq, ...events().map((e) => e.seq));
    };
    return { socket, messages, events, lastSeq };
  };

  it('shows a source’s changes live on the composite, resumes by seq, writes back and drops a revoked source', async () => {
    const alice = await signIn('alice');
    const carol = await signIn('carol');
    const dave = await signIn('dave');

    // Alice's corporation maps C2 - C5 - C1.
    const corp = await alice.call<MapDto>('POST', '/api/maps', { name: 'Corp A' });
    for (const id of [C2, C5, C1])
      await alice.call('POST', `/api/maps/${corp.id}/systems`, { solarSystemId: id });
    const hole = await alice.call<ConnectionDto>('POST', `/api/maps/${corp.id}/connections`, {
      source: C2,
      target: C5,
    });
    await alice.call('POST', `/api/maps/${corp.id}/connections`, { source: C5, target: C1 });

    // Carol runs the alliance chain; Dave edits it.
    const alliance = await carol.call<MapDto>('POST', '/api/maps', {
      name: 'Alliance chain',
      kind: 'composite',
    });
    expect(alliance.kind).toBe('composite');
    await carol.call('POST', `/api/maps/${alliance.id}/access-rules`, {
      subjectKind: 'account',
      subjectId: dave.me.account.id,
      role: 'member',
    });

    const offered = await alice.call<MapShareDto>('POST', `/api/maps/${corp.id}/shares`, {
      targetSlug: alliance.slug,
      level: 'read-write',
    });
    expect(offered.status).toBe('offered');
    expect(await dave.status('POST', `/api/maps/${alliance.id}/shares/${offered.id}/accept`, {})).toBe(403);
    await carol.call('POST', `/api/maps/${alliance.id}/shares/${offered.id}/accept`, {});

    const stream = `map:${alliance.id}`;
    const snapshot = await carol.call<StreamSnapshotDto>(
      'GET',
      `/api/streams/${encodeURIComponent(stream)}/snapshot`,
    );
    const data = snapshot.data as MapSnapshot;
    expect(data.sources!.map((s) => s.name)).toEqual(['Alliance chain', 'Corp A']);
    expect(data.systems!.map((s) => s.solarSystemId).sort()).toEqual([C2, C5, C1].sort());
    // Dave cannot read Corp A itself: sharing gives the composite's viewers nothing of the source.
    expect(await dave.status('GET', `/api/maps/${corp.id}`)).toBe(404);

    // Live: Alice marks the hole EOL, the composite's stream has it within a tick.
    const live = await open(dave.cookie, stream, snapshot.seq);
    await alice.call('PATCH', `/api/maps/${corp.id}/connections/${hole.id}`, { timeStatus: 'eol' });
    await vi.waitFor(() =>
      expect(live.events()).toContainEqual(
        expect.objectContaining({
          type: 'connection.updated',
          data: expect.objectContaining({ timeStatus: 'eol' }),
        }),
      ),
    );
    const seen = live.lastSeq();
    live.socket.close();

    // Missed while away, replayed by seq afterwards.
    await alice.call('PATCH', `/api/maps/${corp.id}/systems/${C1}`, { visible: false });
    await vi.waitFor(async () => {
      const latest = await carol.call<StreamSnapshotDto>(
        'GET',
        `/api/streams/${encodeURIComponent(stream)}/snapshot`,
      );
      expect(latest.seq).toBeGreaterThan(seen);
    });
    const back = await open(dave.cookie, stream, seen);
    await vi.waitFor(() =>
      expect(back.events().map((e) => e.type)).toEqual(
        expect.arrayContaining(['connection.removed', 'system.removed']),
      ),
    );
    expect(back.messages.find((m) => m.op === 'subscribed')).toMatchObject({ mode: 'replay' });

    // Dave edits through the composite: it lands on Corp A, and comes back merged.
    const merged = (
      await carol.call<StreamSnapshotDto>('GET', `/api/streams/${encodeURIComponent(stream)}/snapshot`)
    ).data as MapSnapshot;
    const edge = merged.connections!.find((c) => c.source === Math.min(C2, C5))!;
    await dave.call('PATCH', `/api/maps/${alliance.id}/connections/${encodeURIComponent(edge.id)}`, {
      massStatus: 'critical',
    });
    const inCorp = await alice.call<{ connections: ConnectionDto[] }>(
      'GET',
      `/api/streams/${encodeURIComponent(`map:${corp.id}`)}/snapshot`,
    );
    expect((inCorp as unknown as StreamSnapshotDto).data).toMatchObject({
      connections: [expect.objectContaining({ massStatus: 'critical' })],
    });
    await vi.waitFor(() =>
      expect(back.events()).toContainEqual(
        expect.objectContaining({
          type: 'connection.updated',
          data: expect.objectContaining({ massStatus: 'critical' }),
        }),
      ),
    );
    // The plain map routes work on the composite too: adding C1 back writes it to Corp A.
    await dave.call('POST', `/api/maps/${alliance.id}/systems`, { solarSystemId: C1 });
    await vi.waitFor(async () => {
      const corpNow = await alice.call<StreamSnapshotDto>(
        'GET',
        `/api/streams/${encodeURIComponent(`map:${corp.id}`)}/snapshot`,
      );
      expect((corpNow.data as MapSnapshot).systems!.map((s) => s.solarSystemId)).toContain(C1);
    });

    // Revoked: the source's objects leave the composite at once.
    await alice.call('DELETE', `/api/maps/${corp.id}/shares/${offered.id}`);
    await vi.waitFor(() =>
      expect(back.events().filter((e) => e.type === 'system.removed').length).toBeGreaterThanOrEqual(3),
    );
    const after = (
      await carol.call<StreamSnapshotDto>('GET', `/api/streams/${encodeURIComponent(stream)}/snapshot`)
    ).data as MapSnapshot;
    expect(after.systems).toEqual([]);
    expect(after.sources!.map((s) => s.name)).toEqual(['Alliance chain']);
  });

  it('keeps a name and custom label cleared on the composite cleared over intel a source keeps hidden', async () => {
    const alice = await signIn('alice'); // Corp A's admin: maps C5 and sets nothing on it
    const bob = await signIn('bob'); // the intel map's admin: named C5, then hid it
    const carol = await signIn('carol'); // the alliance chain's admin
    const dave = await signIn('dave'); // edits the alliance chain only
    const corp = await alice.call<MapDto>('POST', '/api/maps', { name: 'Corp A' });
    await alice.call('POST', `/api/maps/${corp.id}/systems`, { solarSystemId: C5 });
    const intel = await bob.call<MapDto>('POST', '/api/maps', { name: 'Intel' });
    await bob.call('POST', `/api/maps/${intel.id}/systems`, { solarSystemId: C5 });
    await bob.call('PATCH', `/api/maps/${intel.id}/systems/${C5}`, {
      customName: 'Graniczny, Jita 5',
      customLabel: 'S',
    });
    await bob.call('DELETE', `/api/maps/${intel.id}/systems/${C5}`);
    const alliance = await carol.call<MapDto>('POST', '/api/maps', {
      name: 'Alliance chain',
      kind: 'composite',
    });
    await carol.call('POST', `/api/maps/${alliance.id}/access-rules`, {
      subjectKind: 'account',
      subjectId: dave.me.account.id,
      role: 'member',
    });
    for (const [who, map] of [
      [alice, corp],
      [bob, intel],
    ] as const) {
      const offered = await who.call<MapShareDto>('POST', `/api/maps/${map.id}/shares`, {
        targetSlug: alliance.slug,
        level: 'read-write',
        scopes: ['topology', 'intel', 'labels'],
      });
      await carol.call('POST', `/api/maps/${alliance.id}/shares/${offered.id}/accept`, {});
    }

    const stream = `map:${alliance.id}`;
    const shown = async () =>
      (
        (await dave.call<StreamSnapshotDto>('GET', `/api/streams/${encodeURIComponent(stream)}/snapshot`))
          .data as MapSnapshot
      ).systems!.find((s) => s.solarSystemId === C5);
    await vi.waitFor(async () =>
      expect(await shown()).toMatchObject({ customName: 'Graniczny, Jita 5', customLabel: 'S' }),
    );

    // Cleared on the composite: only Corp A shows C5, and it holds no name already.
    await dave.call('PATCH', `/api/maps/${alliance.id}/systems/${C5}`, {
      customName: null,
      customLabel: null,
    });
    await vi.waitFor(async () =>
      expect(await shown()).toMatchObject({ customName: null, customLabel: null }),
    );
    // The intel map shows C5 again with its older name: read again, the newer clearing still wins.
    await bob.call('POST', `/api/maps/${intel.id}/systems`, { solarSystemId: C5 });
    await vi.waitFor(async () => expect((await shown())!.provenance!.sources).toHaveLength(2));
    expect(await shown()).toMatchObject({ customName: null, customLabel: null });
  });

  it('shows a system locked on a source as locked, refuses removing it, and lets only the source’s managers unlock it', async () => {
    const alice = await signIn('alice'); // Corp A's admin
    const carol = await signIn('carol'); // the alliance chain's admin
    const dave = await signIn('dave'); // edits the alliance chain only
    const corp = await alice.call<MapDto>('POST', '/api/maps', { name: 'Corp A' });
    for (const id of [C2, C5])
      await alice.call('POST', `/api/maps/${corp.id}/systems`, { solarSystemId: id });
    await alice.call('PATCH', `/api/maps/${corp.id}/systems/${C5}`, { locked: true });
    const alliance = await carol.call<MapDto>('POST', '/api/maps', {
      name: 'Alliance chain',
      kind: 'composite',
    });
    for (const who of [dave, alice])
      await carol.call('POST', `/api/maps/${alliance.id}/access-rules`, {
        subjectKind: 'account',
        subjectId: who.me.account.id,
        role: 'member',
      });
    const offered = await alice.call<MapShareDto>('POST', `/api/maps/${corp.id}/shares`, {
      targetSlug: alliance.slug,
      level: 'read-write',
    });
    await carol.call('POST', `/api/maps/${alliance.id}/shares/${offered.id}/accept`, {});

    const stream = `map:${alliance.id}`;
    const snapshot = async () =>
      (await dave.call<StreamSnapshotDto>('GET', `/api/streams/${encodeURIComponent(stream)}/snapshot`))
        .data as MapSnapshot;
    await vi.waitFor(async () =>
      expect((await snapshot()).systems!.find((s) => s.solarSystemId === C5)).toMatchObject({
        locked: true,
        lockedBy: 'source',
        lockedOn: [{ sourceId: offered.id, name: 'Corp A' }],
      }),
    );

    // Removing it is refused, saying where the lock is; so is unlocking by anyone not managing Corp A.
    const refused = async (who: typeof dave, method: string, path: string, json?: unknown) => {
      const r = await fetch(`http://${base}${path}`, {
        method,
        headers: {
          cookie: who.cookie,
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
      return { status: r.status, message: ((await r.json()) as ApiErrorBody).error.message };
    };
    const system = `/api/maps/${alliance.id}/systems/${C5}`;
    const removal = await refused(dave, 'DELETE', system);
    expect(removal.status).toBe(409);
    expect(removal.message).toMatch(/locked on Corp A/);
    for (const who of [dave, carol]) {
      const unlock = await refused(who, 'PATCH', system, { locked: false });
      expect(unlock.status).toBe(403);
      expect(unlock.message).toMatch(/only a manager of Corp A can unlock it/);
    }

    // Alice manages Corp A: her unlock through the alliance chain lands there, audited as made via it.
    const live = await open(dave.cookie, stream);
    await alice.call('PATCH', system, { locked: false });
    await vi.waitFor(() =>
      expect(live.events()).toContainEqual(
        expect.objectContaining({
          type: 'system.updated',
          data: expect.objectContaining({ solarSystemId: C5, locked: false }),
        }),
      ),
    );
    const history = await alice.call<AuditPageDto>('GET', `/api/maps/${corp.id}/systems/${C5}/history`);
    expect(history.entries[0]).toMatchObject({
      type: 'system.updated',
      via: { mapId: alliance.id, name: 'Alliance chain' },
      diff: { locked: { before: true, after: false } },
    });
    // Now it can go.
    await dave.call('DELETE', system);
  });
});
