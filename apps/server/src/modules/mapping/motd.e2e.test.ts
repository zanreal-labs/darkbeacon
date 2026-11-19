import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditPageDto,
  AuditRevertDto,
  ImportMapResultDto,
  MapDto,
  MapExportDocument,
  MapMotdDto,
  ServerMessage,
} from '@darkbeacon/shared';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

const MOTD = 'Fleet comms: **Darkbeacon Ops** in game.\nIntel: [zkill](https://zkillboard.com)';

describeEachDialect('map message of the day over HTTP and WebSocket', (t) => {
  let s: TestApp;
  let map: MapDto;
  let base: string;

  beforeEach(async () => {
    s = await startTestApp(t.db);
    map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home' })).body as MapDto;
    base = `/api/maps/${map.id}`;
    for (const [subjectId, role] of [
      ['vic', 'viewer'],
      ['bob', 'member'],
      ['mia', 'manager'],
    ])
      await s.call('POST', `${base}/access-rules`, 'alice', { subjectKind: 'account', subjectId, role });
  });
  afterEach(async () => {
    await s.close();
  });

  it('lets managers set it, everyone on the map gets it live, and the history says who and when', async () => {
    // A map starts without one: the field is left out.
    expect(map.motd).toBeUndefined();

    // Vic, a viewer, follows the map.
    const socket = new WebSocket(`ws://${s.base}/ws`, { headers: { 'x-test-actor': 'vic' } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    // Viewers and members may not write it; managers may (trimmed), and it is not too long.
    expect((await s.call('PUT', `${base}/motd`, 'vic', { motd: MOTD })).status).toBe(403);
    expect((await s.call('PUT', `${base}/motd`, 'bob', { motd: MOTD })).status).toBe(403);
    expect((await s.call('PUT', `${base}/motd`, 'mia', { motd: 'x'.repeat(2001) })).status).toBe(400);
    const set = await s.call('PUT', `${base}/motd`, 'mia', { motd: `  ${MOTD}\n\n` });
    expect(set.status).toBe(200);
    expect(set.body as MapMotdDto).toEqual({ motd: MOTD });

    // Live to everyone on the map, and with the map from then on, for viewers too.
    const live = () =>
      messages.filter((m) => m.op === 'event' && m.event.type === 'motd.changed') as Array<
        Extract<ServerMessage, { op: 'event' }>
      >;
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    expect(live()[0]!.event.data).toEqual({ motd: MOTD });
    expect(live()[0]!.event.actor).toMatchObject({ kind: 'account', id: 'mia' });
    expect(((await s.call('GET', base, 'vic')).body as MapDto).motd).toBe(MOTD);

    // The same message again changes nothing and publishes nothing.
    await s.call('PUT', `${base}/motd`, 'mia', { motd: MOTD });

    // Clearing it leaves the field out again.
    expect((await s.call('PUT', `${base}/motd`, 'alice', { motd: '' })).body).toEqual({ motd: '' });
    await vi.waitFor(() => expect(live()).toHaveLength(2));
    expect(live()[1]!.event.data).toEqual({ motd: '' });
    expect(((await s.call('GET', base, 'vic')).body as MapDto).motd).toBeUndefined();
    socket.close();

    // Map settings changes keep it.
    await s.call('PUT', `${base}/motd`, 'mia', { motd: MOTD });
    await s.call('PATCH', base, 'alice', { name: 'Home chain' });
    expect(((await s.call('GET', base, 'bob')).body as MapDto).motd).toBe(MOTD);

    // The history: who and when, what changed, and a revert.
    const history = (
      (await s.call('GET', `${base}/history?types=motd.changed`, 'alice')).body as AuditPageDto
    ).entries;
    expect(history.map((e) => e.actor.accountId)).toEqual(['mia', 'alice', 'mia']);
    expect(history[2]!.diff).toEqual({ motd: { before: '', after: MOTD } });
    const reverted = (await s.call('POST', `${base}/history/${history[0]!.id}/revert`, 'alice'))
      .body as AuditRevertDto;
    expect(reverted.entries[0]).toMatchObject({ type: 'motd.changed', revertOf: history[0]!.id });
    expect(((await s.call('GET', base, 'alice')).body as MapDto).motd).toBeUndefined();
  });

  it('carries it in map files', async () => {
    await s.call('PUT', `${base}/motd`, 'alice', { motd: MOTD });
    const file = (await s.call('GET', `${base}/export`, 'alice')).body as MapExportDocument;
    expect(file.map.motd).toBe(MOTD);
    const imported = (await s.call('POST', '/api/maps/import', 'alice', { document: file }))
      .body as ImportMapResultDto;
    expect(((await s.call('GET', `/api/maps/${imported.map.id}`, 'alice')).body as MapDto).motd).toBe(MOTD);

    // Files written before maps had one still import.
    const { motd: _motd, ...older } = file.map;
    const old = (await s.call('POST', '/api/maps/import', 'alice', { document: { ...file, map: older } }))
      .body as ImportMapResultDto;
    expect(((await s.call('GET', `/api/maps/${old.map.id}`, 'alice')).body as MapDto).motd).toBeUndefined();
  });
});
