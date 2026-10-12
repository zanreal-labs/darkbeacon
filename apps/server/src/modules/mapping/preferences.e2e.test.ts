import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { mapStream, type EventLog } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { MapDto, MapPreferencesDto } from '@darkbeacon/shared';
import { EVENT_LOG } from '../../platform/tokens.js';
import { MapUseCases } from '@darkbeacon/mapping';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';

describeEachDialect('map preferences and bookmark templates over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  const call = async (method: string, path: string, user: string | null, body?: unknown) => {
    const response = await fetch(`http://${base}${path}`, {
      method,
      headers: {
        ...(user ? { 'x-test-actor': user } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };

  beforeEach(async () => {
    const config = { ...parseEnv({ NODE_ENV: 'test' }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false });
    app.get(ActorResolverRegistry).use(async (req) => {
      const match = /^(\w+)$/.exec(String(req.headers['x-test-actor'] ?? ''));
      return match ? { kind: 'account', id: match[1]!, instanceRole: 'user' } : null;
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps each account its own viewport and template, private to it', async () => {
    const map = (await call('POST', '/api/maps', 'alice', { name: 'Chain' })).body as MapDto;
    const path = `/api/maps/${map.id}/preferences`;

    expect((await call('GET', path, 'alice')).body).toEqual({
      viewport: null,
      bookmarkTemplate: null,
      bookmarkOrder: null,
      updatedAt: 0,
    });
    const saved = await call('PATCH', path, 'alice', { viewport: { x: -120.5, y: 40, zoom: 0.9 } });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ viewport: { x: -120.5, y: 40, zoom: 0.9 }, bookmarkTemplate: null });

    // A partial update keeps the rest.
    await call('PATCH', path, 'alice', { bookmarkTemplate: '{chainIndex} {sig}' });
    const read = (await call('GET', path, 'alice')).body as MapPreferencesDto;
    expect(read).toMatchObject({
      viewport: { x: -120.5, y: 40, zoom: 0.9 },
      bookmarkTemplate: '{chainIndex} {sig}',
    });
    expect(read.updatedAt).toBeGreaterThan(0);

    expect(await call('PATCH', path, 'alice', { bookmarkTemplate: '{nope}' })).toMatchObject({
      status: 400,
      body: { error: { code: 'validation' } },
    });
    expect(await call('PATCH', path, 'alice', { viewport: { x: 0, y: 0, zoom: 99 } })).toMatchObject({
      status: 400,
    });
    // Someone who cannot see the map does not learn it exists.
    expect((await call('GET', path, 'bob')).status).toBe(404);
    expect((await call('GET', path, null)).status).toBe(401);

    // Private: no events on the map stream.
    const events = await app.get<EventLog>(EVENT_LOG).readSince(mapStream(map.id), 0);
    expect(events.map((e) => e.type)).toEqual(['map.created']);
  });

  it('lets managers set the map default template and publishes it with the settings', async () => {
    const map = (await call('POST', '/api/maps', 'alice', { name: 'Chain' })).body as MapDto;
    const path = `/api/maps/${map.id}/bookmark-template`;

    const set = await call('PUT', path, 'alice', { template: '{sig3} {destClass}' });
    expect(set.status).toBe(200);
    expect((set.body as MapDto).settings).toEqual({
      scopes: ['wormhole'],
      bookmarkTemplate: '{sig3} {destClass}',
    });
    expect(
      ((await call('GET', `/api/maps/${map.id}`, 'alice')).body as MapDto).settings.bookmarkTemplate,
    ).toBe('{sig3} {destClass}');
    expect(await call('PUT', path, 'alice', { template: 'no variables' })).toMatchObject({ status: 400 });
    expect((await call('PUT', path, 'bob', { template: '{sig}' })).status).toBe(404);

    const reset = await call('PUT', path, 'alice', { template: null });
    expect((reset.body as MapDto).settings).toEqual({ scopes: ['wormhole'] });

    const events = await app.get<EventLog>(EVENT_LOG).readSince(mapStream(map.id), 0);
    expect(events.map((e) => e.type)).toEqual([
      'map.created',
      'map.settings_changed',
      'map.settings_changed',
    ]);
  });

  it('drops the preferences with the map', async () => {
    const map = (await call('POST', '/api/maps', 'alice', { name: 'Chain' })).body as MapDto;
    await call('PATCH', `/api/maps/${map.id}/preferences`, 'alice', { viewport: { x: 1, y: 2, zoom: 1 } });
    expect((await call('DELETE', `/api/maps/${map.id}`, 'alice')).status).toBe(204);
    // Deleting is soft; purging takes the preferences.
    await app.get(MapUseCases).purge({ kind: 'account', id: 'root', instanceRole: 'admin' }, map.id);
    const rows = await t.db
      .db<{ map_preferences: { map_id: string } }>()
      .selectFrom('map_preferences')
      .selectAll()
      .execute();
    expect(rows).toEqual([]);
  });
});
