import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  SYSTEMS_CLIPBOARD_KIND,
  type AuditPageDto,
  type ConnectionDto,
  type HubRoutesDto,
  type MapDto,
  type MapPingDto,
  type MapSystemDto,
  type MeDto,
  type PasteSystemsResultDto,
  type StreamSnapshotDto,
  type SystemsClipboardInput,
} from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const JITA = 30000142;
const PERIMETER = 30000144;
const AMARR = 30002187;

class Browser {
  readonly cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  async request(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
    const response = await fetch(`http://${this.base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split('; ');
      const [name, value] = pair!.split('=') as [string, string];
      this.cookies.set(name, value);
    }
    return response;
  }

  async json<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
    const response = await this.request(path, init);
    expect(response.status, `${init.method ?? 'GET'} ${path}: ${response.status}`).toBeLessThan(300);
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }
}

describeEachDialect('the canvas: pings and pasting systems', (t) => {
  let app: NestFastifyApplication;
  let base: string;

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
    await app.close();
  });

  const signIn = async (name: string) => {
    const browser = new Browser(base);
    const me = await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: `${name} Main` } },
    });
    await browser.json('/api/accounts/me/main-character', {
      method: 'PUT',
      json: { characterId: me.characters[0]!.id },
    });
    return { browser, me };
  };

  const share = (owner: Browser, mapId: string, accountId: string, role: string) =>
    owner.json(`/api/maps/${mapId}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'account', subjectId: accountId, role },
    });

  const snapshot = async (b: Browser, mapId: string) =>
    (await b.json<StreamSnapshotDto>(`/api/streams/${encodeURIComponent(`map:${mapId}`)}/snapshot`)).data as {
      systems: MapSystemDto[];
      connections: ConnectionDto[];
    };

  it('calls one rally per map, holds its system on the map and makes it a route target', async () => {
    const { browser: alice } = await signIn('alice');
    const { browser: vera, me: veraMe } = await signIn('vera');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const m = `/api/maps/${map.id}`;
    await share(alice, map.id, veraMe.account.id, 'viewer');
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: JITA } });
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: PERIMETER } });

    // Viewers see pings, members call them.
    expect((await vera.request(`${m}/pings`, { method: 'POST', json: { solarSystemId: JITA } })).status).toBe(
      403,
    );
    const first = await alice.json<MapPingDto>(`${m}/pings`, {
      method: 'POST',
      json: { solarSystemId: JITA, message: 'Form up' },
    });
    expect(first).toMatchObject({
      solarSystemId: JITA,
      type: 'rally',
      message: 'Form up',
      createdByName: 'alice',
      characterName: 'alice Main',
    });
    expect(await vera.json<MapPingDto[]>(`${m}/pings`)).toHaveLength(1);

    // A pinged system stays on the map.
    const refused = await alice.request(`${m}/systems/${JITA}`, { method: 'DELETE' });
    expect(refused.status).toBe(409);

    // A new rally replaces the old one.
    const second = await alice.json<MapPingDto>(`${m}/pings`, {
      method: 'POST',
      json: { solarSystemId: PERIMETER },
    });
    const pings = await alice.json<MapPingDto[]>(`${m}/pings`);
    expect(pings.map((p) => p.id)).toEqual([second.id]);

    // It heads the route targets.
    const hubs = await alice.json<HubRoutesDto>(`${m}/routes/hubs?from=${AMARR}`);
    expect(hubs.routes[0]).toMatchObject({ solarSystemId: PERIMETER, kind: 'ping' });

    // Cancelled, the system may go; the history says who did what.
    await alice.json(`${m}/pings/${second.id}`, { method: 'DELETE' });
    expect(await alice.json<MapPingDto[]>(`${m}/pings`)).toEqual([]);
    await alice.json(`${m}/systems/${PERIMETER}`, { method: 'DELETE' });
    const history = await alice.json<AuditPageDto>(`${m}/history?types=ping.*`);
    expect(history.entries.map((e) => e.type)).toEqual([
      'ping.removed',
      'ping.created',
      'ping.removed',
      'ping.created',
    ]);
  });

  it('pastes copied systems with their attributes, Labels and Tags by name, and their connections', async () => {
    const { browser: alice } = await signIn('alice');
    const { browser: mike, me: mikeMe } = await signIn('mike');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Target' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/system-labels`, {
      method: 'PUT',
      json: { systemLabels: [{ id: 'x1', name: 'WH1', description: '' }] },
    });
    await alice.json(`${m}/labels`, {
      method: 'PUT',
      json: { labels: [{ id: 't1', name: 'Staging', color: '#38c6d6', description: '' }] },
    });
    // AMARR is on the map already and stays as it is.
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: AMARR } });

    const clipboard: SystemsClipboardInput = {
      kind: SYSTEMS_CLIPBOARD_KIND,
      v: 1,
      from: { mapId: 'other', name: 'Source' },
      systems: [
        {
          solarSystemId: JITA,
          position: { x: 1000, y: 500 },
          status: 'hostile',
          customName: 'Trade',
          tag: 'A',
          systemLabels: ['WH1', 'WH9'],
          tags: ['staging'],
          locked: true,
        },
        { solarSystemId: PERIMETER, position: { x: 1300, y: 560 } },
        { solarSystemId: AMARR, position: { x: 1600, y: 500 }, status: 'friendly' },
      ],
      connections: [
        { source: JITA, target: PERIMETER, type: 'gate', dangerous: true },
        { source: PERIMETER, target: AMARR, massStatus: 'critical', shipSize: 'medium' },
      ],
    };
    const result = await alice.json<PasteSystemsResultDto>(`${m}/paste`, {
      method: 'POST',
      json: { clipboard, at: { x: 0, y: 0 } },
    });
    expect(result).toEqual({
      added: [JITA, PERIMETER],
      existing: [AMARR],
      connections: 2,
      missingLabels: ['WH9'],
    });
    const state = await snapshot(alice, map.id);
    const byId = new Map(state.systems.map((s) => [s.solarSystemId, s]));
    expect(byId.get(JITA)).toMatchObject({
      position: { x: 0, y: 0 },
      status: 'hostile',
      customName: 'Trade',
      tag: 'A',
      systemLabelIds: ['x1'],
      labelIds: ['t1'],
      locked: true,
    });
    expect(byId.get(PERIMETER)?.position).toEqual({ x: 300, y: 60 });
    expect(byId.get(AMARR)?.status).toBe('unknown');
    const link = state.connections.find((c) => [c.source, c.target].includes(AMARR))!;
    expect(link).toMatchObject({ massStatus: 'critical', shipSize: 'medium' });
    expect(state.connections.find((c) => [c.source, c.target].includes(JITA))).toMatchObject({
      type: 'gate',
      dangerous: true,
    });

    // Managers say who may paste: members are turned away when it is for managers.
    await share(alice, map.id, mikeMe.account.id, 'member');
    await alice.json(`${m}/clipboard-roles`, { method: 'PUT', json: { copy: 'member', paste: 'manager' } });
    const blocked = await mike.request(`${m}/paste`, {
      method: 'POST',
      json: { clipboard, at: { x: 0, y: 0 } },
    });
    expect(blocked.status).toBe(403);
    const settings = await alice.json<MapDto>(`${m}`);
    expect(settings.settings.clipboard).toEqual({ copy: 'member', paste: 'manager' });
  });
});
