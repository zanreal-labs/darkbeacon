import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditPageDto,
  AuditRevertDto,
  ImportMapResultDto,
  MapDto,
  MapExportDocument,
  MapSettingsExportDocument,
  MapViewDto,
  ServerMessage,
} from '@darkbeacon/shared';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

const view = (visible: string[]) => ({
  version: 1,
  layout: { version: 2, visible, boxes: {}, order: [], caps: { signatures: 440 } },
  canvas: { minimap: 'bottom-left', background: 'lines' },
});

const SCAN = { id: 'scan', name: 'Scan', slot: 1, view: view(['info', 'signatures']), updatedAt: 0 };
const PVP = { id: 'pvp', name: 'PvP', slot: 2, view: view(['info', 'local', 'kills']), updatedAt: 0 };

describeEachDialect('map views over HTTP and WebSocket', (t) => {
  let s: TestApp;
  let map: MapDto;
  let base: string;

  beforeEach(async () => {
    s = await startTestApp(t.db);
    map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home' })).body as MapDto;
    base = `/api/maps/${map.id}`;
    for (const [subjectId, role] of [
      ['bob', 'member'],
      ['mia', 'manager'],
    ])
      await s.call('POST', `${base}/access-rules`, 'alice', { subjectKind: 'account', subjectId, role });
  });
  afterEach(async () => {
    await s.close();
  });

  it('lets managers publish views, every member gets them live, and the history says who and when', async () => {
    // A map starts with none: the field is left out.
    expect(map.views).toBeUndefined();

    // Bob, a member, follows the map.
    const socket = new WebSocket(`ws://${s.base}/ws`, { headers: { 'x-test-actor': 'bob' } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    // Members may not publish; managers may.
    expect((await s.call('PUT', `${base}/views`, 'bob', { views: [SCAN] })).status).toBe(403);
    const published = await s.call('PUT', `${base}/views`, 'mia', { views: [SCAN, PVP] });
    expect(published.status).toBe(200);
    const views = published.body as MapViewDto[];
    expect(views.map((v) => [v.name, v.slot])).toEqual([
      ['Scan', 1],
      ['PvP', 2],
    ]);
    // Stamped with the time it was published.
    expect(views.every((v) => v.updatedAt > 0)).toBe(true);

    // Live to everyone on the map, and with the map from then on.
    await vi.waitFor(() =>
      expect(messages.some((m) => m.op === 'event' && m.event.type === 'views.changed')).toBe(true),
    );
    const live = messages.find((m) => m.op === 'event' && m.event.type === 'views.changed') as Extract<
      ServerMessage,
      { op: 'event' }
    >;
    expect(live.event.data).toEqual({ views });
    expect(live.event.actor).toMatchObject({ kind: 'account', id: 'mia' });
    expect(((await s.call('GET', base, 'bob')).body as MapDto).views).toEqual(views);
    socket.close();

    // Two views on one slot, a duplicate name, an unknown format: refused.
    for (const bad of [
      [SCAN, { ...PVP, slot: 1 }],
      [SCAN, { ...PVP, id: 'x', name: 'scan' }],
      [{ ...SCAN, view: { ...SCAN.view, version: 9 } }],
    ])
      expect((await s.call('PUT', `${base}/views`, 'mia', { views: bad })).status).toBe(400);

    // Nothing changed: no event, the same times.
    const again = (await s.call('PUT', `${base}/views`, 'mia', { views })).body as MapViewDto[];
    expect(again).toEqual(views);

    // Renaming one keeps the other's time.
    const renamed = (
      await s.call('PUT', `${base}/views`, 'alice', { views: [{ ...views[0]!, name: 'Scanning' }, views[1]] })
    ).body as MapViewDto[];
    expect(renamed[1]).toEqual(views[1]);

    // The history: who and when, what changed, and a revert.
    const history = (
      (await s.call('GET', `${base}/history?types=views.changed`, 'alice')).body as AuditPageDto
    ).entries;
    expect(history.map((e) => e.actor.accountId)).toEqual(['alice', 'mia']);
    expect(history[1]!.diff).toEqual({ views: { before: [], after: views } });
    expect(history[0]!.occurredAt).toBeGreaterThan(0);
    const reverted = (await s.call('POST', `${base}/history/${history[0]!.id}/revert`, 'alice'))
      .body as AuditRevertDto;
    expect(reverted.entries[0]).toMatchObject({ type: 'views.changed', revertOf: history[0]!.id });
    expect(((await s.call('GET', base, 'alice')).body as MapDto).views!.map((v) => v.name)).toEqual([
      'Scan',
      'PvP',
    ]);

    // Clearing the list leaves the field out again.
    await s.call('PUT', `${base}/views`, 'mia', { views: [] });
    expect(((await s.call('GET', base, 'bob')).body as MapDto).views).toBeUndefined();
  });

  it('carries the views in map files and settings files', async () => {
    await s.call('PUT', `${base}/views`, 'alice', { views: [SCAN, PVP] });
    const published = ((await s.call('GET', base, 'alice')).body as MapDto).views!;

    const file = (await s.call('GET', `${base}/export`, 'alice')).body as MapExportDocument;
    expect(file.map.views).toEqual(published);
    const imported = (await s.call('POST', '/api/maps/import', 'alice', { document: file }))
      .body as ImportMapResultDto;
    const copy = (await s.call('GET', `/api/maps/${imported.map.id}`, 'alice')).body as MapDto;
    expect(copy.views).toEqual(published);

    // Files written before maps had views still import.
    const { views: _views, ...older } = file.map;
    const old = (await s.call('POST', '/api/maps/import', 'alice', { document: { ...file, map: older } }))
      .body as ImportMapResultDto;
    expect(((await s.call('GET', `/api/maps/${old.map.id}`, 'alice')).body as MapDto).views).toBeUndefined();

    // The settings file carries them to another map.
    const settings = (await s.call('GET', `${base}/settings/export`, 'alice'))
      .body as MapSettingsExportDocument;
    expect(settings.views).toEqual(published);
    const other = (await s.call('POST', '/api/maps', 'alice', { name: 'Other' })).body as MapDto;
    await s.call('POST', `/api/maps/${other.id}/settings/import`, 'alice', { document: settings });
    const target = (await s.call('GET', `/api/maps/${other.id}`, 'alice')).body as MapDto;
    expect(target.views!.map((v) => [v.id, v.name, v.slot, v.view])).toEqual(
      published.map((v) => [v.id, v.name, v.slot, v.view]),
    );
  });
});
