import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { BatchUpsertResultDto, ConnectionDto, EventsPageDto, MapDto } from '@darkbeacon/shared';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { SseReader } from '../../test-support/sse.js';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

describeEachDialect('map integration API over HTTP', (t) => {
  let s: TestApp;

  beforeEach(async () => {
    s = await startTestApp(t.db);
  });
  afterEach(async () => {
    await s.close();
  });

  it('upserts and deletes in batches and finds connections by their systems', async () => {
    const map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home' })).body as MapDto;
    const base = `/api/maps/${map.id}`;

    const upserted = await s.call('POST', `${base}/batch`, 'alice', {
      systems: [
        { solarSystemId: SYSTEMS.c2, position: { x: 0, y: 0 }, tag: 'H', status: 'home' },
        { solarSystemId: SYSTEMS.c5 },
      ],
      connections: [{ source: SYSTEMS.c2, target: SYSTEMS.c5, massStatus: 'reduced' }],
    });
    expect(upserted.status).toBe(200);
    const result = upserted.body as BatchUpsertResultDto;
    expect(result.systems.map((x) => [x.solarSystemId, x.tag])).toEqual([
      [SYSTEMS.c2, 'H'],
      [SYSTEMS.c5, null],
    ]);
    expect(result.connections[0]).toMatchObject({ massStatus: 'reduced' });

    // Upserting again changes what is given and finds the connection either way round.
    const again = await s.call('POST', `${base}/batch`, 'alice', {
      systems: [{ solarSystemId: SYSTEMS.c5, customName: 'Static' }],
      connections: [{ source: SYSTEMS.c5, target: SYSTEMS.c2, timeStatus: 'eol' }],
    });
    expect((again.body as BatchUpsertResultDto).connections[0]).toMatchObject({
      id: result.connections[0]!.id,
      timeStatus: 'eol',
      massStatus: 'reduced',
    });

    // All or nothing: an unknown system fails the batch and nothing of it stays.
    expect(
      (
        await s.call('POST', `${base}/batch`, 'alice', {
          systems: [{ solarSystemId: SYSTEMS.c1 }, { solarSystemId: 31999999 }],
        })
      ).status,
    ).toBe(404);
    const snap = (await s.call('GET', `/api/streams/map:${map.id}/snapshot`, 'alice')).body as {
      data: { systems: unknown[] };
    };
    expect(snap.data.systems).toHaveLength(2);

    // By pair, either direction.
    const pair = `${base}/connections/between/${SYSTEMS.c5}/${SYSTEMS.c2}`;
    expect((await s.call('GET', pair, 'alice')).body).toMatchObject({ id: result.connections[0]!.id });
    expect(await s.call('PATCH', pair, 'alice', { massStatus: 'critical' })).toMatchObject({
      status: 200,
      body: { massStatus: 'critical' },
    });
    expect(
      (await s.call('GET', `${base}/connections/between/${SYSTEMS.c5}/${SYSTEMS.c1}`, 'alice')).status,
    ).toBe(404);
    expect((await s.call('DELETE', pair, 'alice')).status).toBe(204);
    expect((await s.call('GET', pair, 'alice')).status).toBe(404);

    const linked = (
      await s.call('POST', `${base}/connections`, 'alice', { source: SYSTEMS.c2, target: SYSTEMS.c5 })
    ).body as ConnectionDto;
    const deleted = await s.call('POST', `${base}/batch/delete`, 'alice', {
      connections: [linked.id, { source: SYSTEMS.c1, target: SYSTEMS.c2 }],
      systems: [SYSTEMS.c5],
    });
    expect(deleted).toMatchObject({ status: 200, body: { connections: 1, systems: 1, missing: 1 } });
    // Viewers cannot.
    await s.call('POST', `${base}/access-rules`, 'alice', {
      subjectKind: 'account',
      subjectId: 'vic',
      role: 'viewer',
    });
    expect((await s.call('POST', `${base}/batch/delete`, 'vic', { systems: [SYSTEMS.c2] })).status).toBe(403);
  });

  it('pages events after a seq and streams them as Server-Sent Events', async () => {
    const map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home' })).body as MapDto;
    const base = `/api/maps/${map.id}`;
    await s.call('POST', `${base}/systems`, 'alice', { solarSystemId: SYSTEMS.c2 });
    await s.call('POST', `${base}/systems`, 'alice', { solarSystemId: SYSTEMS.c5 });

    const first = (await s.call('GET', `${base}/events?sinceSeq=0&limit=2`, 'alice')).body as EventsPageDto;
    expect(first.events.map((e) => e.type)).toEqual(['map.created', 'system.added']);
    expect(first).toMatchObject({ nextSeq: 2, more: true, gap: false });
    const rest = (await s.call('GET', `${base}/events?sinceSeq=${first.nextSeq}&types=system.*`, 'alice'))
      .body as EventsPageDto;
    expect(rest.events.map((e) => [e.type, e.seq])).toEqual([['system.added', 3]]);
    expect(rest).toMatchObject({ nextSeq: 3, headSeq: 3, more: false });
    expect((await s.call('GET', `${base}/events`, 'mallory')).status).toBe(404);
    expect((await s.call('GET', `${base}/events`, null)).status).toBe(401);

    // SSE: resume after seq 2, then live.
    const sse = new SseReader(`http://${s.base}/api/streams/map:${map.id}/sse?sinceSeq=2&types=system.*`, {
      'x-test-actor': 'alice',
    });
    const response = await sse.response;
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const replayed = await sse.waitFor((f) => f.event === 'system.added');
    expect(replayed.id).toBe('3');
    await sse.waitFor((f) => f.event === 'subscribed');
    await s.call('PATCH', `${base}/systems/${SYSTEMS.c5}`, 'alice', { tag: 'X' });
    await s.call('PUT', `${base}/labels`, 'alice', { labels: [] }); // not a system event: filtered
    const live = await sse.waitFor((f) => f.event === 'system.updated');
    expect((live.data as DomainEvent<{ tag: string }>).data.tag).toBe('X');
    expect(sse.frames.some((f) => f.event === 'labels.changed')).toBe(false);
    await sse.close();

    // Without a seq it starts at the newest event; Last-Event-ID resumes like sinceSeq.
    const resumed = new SseReader(`http://${s.base}/api/streams/map:${map.id}/sse`, {
      'x-test-actor': 'alice',
      'last-event-id': '1',
    });
    await resumed.waitFor((f) => f.event === 'subscribed');
    expect(resumed.events('system.added').map((f) => f.id)).toEqual(['2', '3']);
    await resumed.close();

    // Someone who cannot see the map gets no stream.
    const denied = await fetch(`http://${s.base}/api/streams/map:${map.id}/sse`, {
      headers: { 'x-test-actor': 'mallory' },
    });
    expect(denied.status).toBe(404);
  });
});
