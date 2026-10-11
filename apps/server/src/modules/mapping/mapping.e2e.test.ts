import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@wormwright/db/testing';
import type { MapDto, MapSnapshot, MapSystemDto, ServerMessage } from '@wormwright/shared';
import WebSocket from 'ws';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';

/** universe.json in the data directory, the way an operator would provide it. */
function dataDirWithUniverse(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-mapping-'));
  const system = (id: number, name: string, whClass: number) => ({
    id,
    name,
    regionId: 1,
    constellationId: 2,
    security: -1,
    whClass,
    gates: [],
  });
  writeFileSync(
    join(dir, 'universe.json'),
    JSON.stringify({
      source: 'test',
      regions: [{ id: 1, name: 'A-R00001' }],
      constellations: [{ id: 2, name: 'A-C00001', regionId: 1 }],
      systems: [system(SYSTEMS.c2, 'J100101', 2), system(SYSTEMS.c5, 'J100104', 5)],
    }),
  );
  return dir;
}

describeEachDialect('mapping over HTTP and WebSocket', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  const call = async (method: string, path: string, user: string | null, body?: unknown) => {
    const response = await fetch(`http://${base}${path}`, {
      method,
      headers: {
        ...(user ? { authorization: `Bearer ${user}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test' }),
      secretKey: 'x'.repeat(32),
      dataDir: dataDirWithUniverse(),
    };
    app = await createApp(config, { database: t.db, logger: false, webDist: '/nonexistent' });
    // Stand-in for the identity module: the bearer token names the account.
    app.get(ActorResolverRegistry).use(async (req) => {
      const match = /^Bearer (\w+)$/.exec(String(req.headers.authorization ?? ''));
      return match ? { kind: 'account', id: match[1]!, instanceRole: 'user' } : null;
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the mapping REST API', async () => {
    expect((await call('POST', '/api/maps', null, { name: 'Chain' })).status).toBe(401);
    expect(await call('POST', '/api/maps', 'alice', { name: '' })).toMatchObject({
      status: 400,
      body: { error: { code: 'validation' } },
    });
    const created = await call('POST', '/api/maps', 'alice', { name: 'Chain' });
    expect(created.status).toBe(201);
    const map = created.body as MapDto;
    expect(map).toMatchObject({ slug: 'chain', ownerAccountId: 'alice' });

    expect((await call('GET', '/api/maps', 'alice')).body).toEqual([
      { id: map.id, slug: 'chain', name: 'Chain', role: 'admin' },
    ]);
    expect((await call('GET', '/api/maps/by-slug/chain', 'alice')).body).toEqual(map);
    // Without access the map does not exist.
    expect((await call('GET', `/api/maps/${map.id}`, 'bob')).status).toBe(404);
    expect((await call('GET', '/api/maps', 'bob')).body).toEqual([]);

    const systems = `/api/maps/${map.id}/systems`;
    expect((await call('POST', systems, 'alice', { solarSystemId: SYSTEMS.c2 })).status).toBe(201);
    expect((await call('POST', systems, 'alice', { solarSystemId: SYSTEMS.jita })).status).toBe(404);
    const patched = await call('PATCH', `${systems}/${SYSTEMS.c2}`, 'alice', { tag: 'A', status: 'home' });
    expect(patched.body).toMatchObject({ tag: 'A', status: 'home' });
    expect((await call('PATCH', `${systems}/abc`, 'alice', { tag: 'A' })).status).toBe(400);
    expect(
      (
        await call('POST', `${systems}/positions`, 'alice', {
          positions: [{ solarSystemId: SYSTEMS.c2, x: 5, y: 6 }],
        })
      ).status,
    ).toBe(204);

    const pasted = await call('POST', `${systems}/${SYSTEMS.c2}/signatures/paste`, 'alice', {
      text: 'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.32 AU',
    });
    expect(pasted).toEqual({ status: 200, body: { added: 1, updated: 0, removed: 0, skipped: [] } });
    const listed = await call('GET', `${systems}/${SYSTEMS.c2}/signatures`, 'alice');
    expect(listed.body).toEqual([expect.objectContaining({ eveId: 'ABC-123', group: 'wormhole' })]);

    await call('POST', systems, 'alice', { solarSystemId: SYSTEMS.c5 });
    const connection = await call('POST', `/api/maps/${map.id}/connections`, 'alice', {
      source: SYSTEMS.c2,
      target: SYSTEMS.c5,
    });
    expect(connection).toMatchObject({ status: 201, body: { type: 'wormhole', shipSize: 'large' } });
    const connectionId = (connection.body as { id: string }).id;
    expect(
      (
        await call('PATCH', `/api/maps/${map.id}/connections/${connectionId}`, 'alice', {
          massStatus: 'reduced',
        })
      ).body,
    ).toMatchObject({ massStatus: 'reduced' });
    expect((await call('DELETE', `/api/maps/${map.id}/connections/${connectionId}`, 'alice')).status).toBe(
      204,
    );

    expect(
      (
        await call('PUT', `/api/maps/${map.id}/labels`, 'alice', {
          labels: [{ id: 'l1', name: 'Static', color: '#123456', description: 'C5 static' }],
        })
      ).body,
    ).toEqual([{ id: 'l1', name: 'Static', color: '#123456', description: 'C5 static' }]);
    expect((await call('PATCH', `/api/maps/${map.id}`, 'alice', { slug: 'renamed' })).body).toMatchObject({
      slug: 'renamed',
    });

    expect((await call('GET', '/api/universe/systems?q=j1001&limit=1', 'alice')).body).toEqual([
      expect.objectContaining({ id: SYSTEMS.c2, name: 'J100101', regionName: 'A-R00001', whClass: 2 }),
    ]);
    expect((await call('GET', `/api/universe/systems/${SYSTEMS.c5}`, 'alice')).body).toMatchObject({
      name: 'J100104',
    });
    expect((await call('GET', '/api/universe/systems?q=j', null)).status).toBe(401);

    expect((await call('DELETE', `${systems}/${SYSTEMS.c5}`, 'alice')).status).toBe(204);
    expect((await call('DELETE', `/api/maps/${map.id}`, 'alice')).status).toBe(204);
    expect((await call('GET', `/api/maps/${map.id}`, 'alice')).status).toBe(404);
  });

  it('sends the map snapshot without hidden systems, then live events', async () => {
    const map = (await call('POST', '/api/maps', 'alice', { name: 'Chain' })).body as MapDto;
    const systems = `/api/maps/${map.id}/systems`;
    await call('POST', systems, 'alice', { solarSystemId: SYSTEMS.c2 });
    await call('POST', systems, 'alice', { solarSystemId: SYSTEMS.c5 });
    await call('POST', `${systems}/${SYSTEMS.c5}/signatures`, 'alice', { eveId: 'ABC-123' });
    await call('DELETE', `${systems}/${SYSTEMS.c5}`, 'alice');

    const socket = new WebSocket(`ws://${base}/ws`, { headers: { authorization: 'Bearer alice' } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    const snapshot = messages.find((m) => m.op === 'snapshot');
    const data = (snapshot as { data: MapSnapshot }).data;
    expect(data.map).toEqual(map);
    expect(data.systems?.map((s) => s.solarSystemId)).toEqual([SYSTEMS.c2]);
    expect(data.connections).toEqual([]);
    expect(data.signatures).toEqual([]);

    // Restoring the hidden system publishes it with the intel it kept.
    await call('POST', systems, 'alice', { solarSystemId: SYSTEMS.c5 });
    await vi.waitFor(() => expect(messages.filter((m) => m.op === 'event')).toHaveLength(2));
    const live = messages.filter((m) => m.op === 'event').map((m) => m.event);
    expect(live.map((e) => e.type)).toEqual(['system.added', 'signature.added']);
    expect((live[0]!.data as MapSystemDto).solarSystemId).toBe(SYSTEMS.c5);

    // Strangers cannot follow the map.
    const stranger = new WebSocket(`ws://${base}/ws`, { headers: { authorization: 'Bearer bob' } });
    const refused: ServerMessage[] = [];
    stranger.on('message', (raw) => refused.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise((resolve) => stranger.once('open', resolve));
    stranger.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
    await vi.waitFor(() =>
      expect(refused).toEqual([expect.objectContaining({ op: 'error', code: 'forbidden' })]),
    );
    socket.close();
    stranger.close();
  });
});
