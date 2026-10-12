import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  ACTION_HEADER,
  type ConnectionDto,
  type MapDto,
  type MapSystemDto,
  type MeDto,
  type SignatureDto,
  type StreamSnapshotDto,
  type UndoResultDto,
} from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const JITA = 30000142;
const PERIMETER = 30000144;
const AMARR = 30002187;

/** A browser with a cookie jar that names its gestures like the web app does. */
class Browser {
  readonly cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  async request(
    path: string,
    init: { method?: string; json?: unknown; action?: string } = {},
  ): Promise<Response> {
    const response = await fetch(`http://${this.base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.action ? { [ACTION_HEADER]: init.action } : {}),
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

  async json<T>(path: string, init: { method?: string; json?: unknown; action?: string } = {}): Promise<T> {
    const response = await this.request(path, init);
    expect(response.status, `${init.method ?? 'GET'} ${path}: ${response.status}`).toBeLessThan(300);
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }
}

describeEachDialect('undo of a gesture', (t) => {
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
    return { browser, me };
  };

  const snapshot = async (b: Browser, mapId: string) => {
    const snap = await b.json<StreamSnapshotDto>(
      `/api/streams/${encodeURIComponent(`map:${mapId}`)}/snapshot`,
    );
    return snap.data as {
      systems: MapSystemDto[];
      connections: ConnectionDto[];
      signatures: SignatureDto[];
    };
  };

  it('puts a removed system back with its connections, their flags and linked signatures', async () => {
    const { browser: alice } = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const m = `/api/maps/${map.id}`;
    for (const [id, x] of [
      [JITA, 0],
      [PERIMETER, 300],
      [AMARR, 600],
    ] as const)
      await alice.json(`${m}/systems`, {
        method: 'POST',
        json: { solarSystemId: id, position: { x, y: 0 } },
      });
    const a = await alice.json<ConnectionDto>(`${m}/connections`, {
      method: 'POST',
      json: { source: JITA, target: PERIMETER },
    });
    await alice.json(`${m}/connections`, { method: 'POST', json: { source: PERIMETER, target: AMARR } });
    await alice.json(`${m}/connections/${a.id}`, {
      method: 'PATCH',
      json: { dangerous: true, massStatus: 'critical', shipSize: 'medium' },
    });
    const sig = await alice.json<SignatureDto>(`${m}/systems/${JITA}/signatures`, {
      method: 'POST',
      json: { eveId: 'ABC-123', group: 'wormhole' },
    });
    await alice.json(`${m}/signatures/${sig.id}`, { method: 'PATCH', json: { connectionId: a.id } });

    // One gesture: Delete on PERIMETER.
    await alice.json(`${m}/systems/${PERIMETER}`, { method: 'DELETE', action: 'gesture-remove-1' });
    let state = await snapshot(alice, map.id);
    expect(state.systems.map((s) => s.solarSystemId).sort()).toEqual([JITA, AMARR].sort());
    expect(state.connections).toHaveLength(0);

    const undone = await alice.json<UndoResultDto>(`${m}/history/undo`, {
      method: 'POST',
      json: { action: 'gesture-remove-1' },
    });
    expect(undone.failed).toEqual([]);
    expect(undone.reverted.length).toBeGreaterThanOrEqual(3);

    state = await snapshot(alice, map.id);
    expect(state.systems.map((s) => s.solarSystemId).sort()).toEqual([JITA, PERIMETER, AMARR].sort());
    expect(state.connections).toHaveLength(2);
    const back = state.connections.find(
      (c) => [c.source, c.target].includes(JITA) && [c.source, c.target].includes(PERIMETER),
    )!;
    expect(back).toMatchObject({ dangerous: true, massStatus: 'critical', shipSize: 'medium' });
    // The signature leads through the connection that replaced the removed one.
    expect(state.signatures.find((s) => s.id === sig.id)?.connectionId).toBe(back.id);

    // Twice is refused; so is someone else's gesture.
    expect(
      (await alice.request(`${m}/history/undo`, { method: 'POST', json: { action: 'gesture-remove-1' } }))
        .status,
    ).toBe(409);
  });

  it('undoes a whole multi-request gesture, and only the gesture of its own author', async () => {
    const { browser: alice } = await signIn('alice');
    const { browser: bob, me: bobMe } = await signIn('bob');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'account', subjectId: bobMe.account.id, role: 'member' },
    });
    await alice.json(`${m}/systems`, {
      method: 'POST',
      json: { solarSystemId: JITA, position: { x: 0, y: 0 } },
    });
    await alice.json(`${m}/systems`, {
      method: 'POST',
      json: { solarSystemId: PERIMETER, position: { x: 300, y: 0 } },
    });
    // A drag of two systems, then a bulk status change: two requests of one gesture.
    await alice.request(`${m}/systems/positions`, {
      method: 'POST',
      action: 'gesture-move-01',
      json: {
        positions: [
          { solarSystemId: JITA, x: 50, y: 50 },
          { solarSystemId: PERIMETER, x: 350, y: 50 },
        ],
      },
    });
    await alice.json(`${m}/systems/${JITA}`, {
      method: 'PATCH',
      json: { status: 'hostile' },
      action: 'gesture-status',
    });
    await alice.json(`${m}/systems/${PERIMETER}`, {
      method: 'PATCH',
      json: { status: 'hostile' },
      action: 'gesture-status',
    });

    // Bob may undo his own gestures here, not Alice's.
    expect(
      (await bob.request(`${m}/history/undo`, { method: 'POST', json: { action: 'gesture-status' } })).status,
    ).toBe(404);

    await alice.json(`${m}/history/undo`, { method: 'POST', json: { action: 'gesture-status' } });
    await alice.json(`${m}/history/undo`, { method: 'POST', json: { action: 'gesture-move-01' } });
    const state = await snapshot(alice, map.id);
    const byId = new Map(state.systems.map((s) => [s.solarSystemId, s]));
    expect(byId.get(JITA)).toMatchObject({ status: 'unknown', position: { x: 0, y: 0 } });
    expect(byId.get(PERIMETER)).toMatchObject({ status: 'unknown', position: { x: 300, y: 0 } });
  });

  it('leaves a change that changed again since, and says so', async () => {
    const { browser: alice } = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: JITA } });
    await alice.json(`${m}/systems/${JITA}`, {
      method: 'PATCH',
      json: { tag: 'A' },
      action: 'gesture-tag-a',
    });
    await alice.json(`${m}/systems/${JITA}`, {
      method: 'PATCH',
      json: { tag: 'B' },
      action: 'gesture-tag-b',
    });
    const refused = await alice.request(`${m}/history/undo`, {
      method: 'POST',
      json: { action: 'gesture-tag-a' },
    });
    expect(refused.status).toBe(409);
    // Newest first works.
    await alice.json(`${m}/history/undo`, { method: 'POST', json: { action: 'gesture-tag-b' } });
    await alice.json(`${m}/history/undo`, { method: 'POST', json: { action: 'gesture-tag-a' } });
    const state = await snapshot(alice, map.id);
    expect(state.systems[0]?.tag).toBeNull();
  });
});
