import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  ConnectionDto,
  ConnectionIntelDto,
  FitMassDto,
  MapDto,
  MapShareDto,
  MapSnapshot,
  MeDto,
  PassageDto,
  RollPlanDto,
  ShipCatalogDto,
  ShipTypeDto,
  StreamSnapshotDto,
} from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { SweeperRuntime } from './sweeper.runtime.js';

const C2 = 31000399; // J130256: statics B274 (HS), O477 (C3)
const C3 = 31002531; // J014348: statics D845 (HS), U210 (LS)
const MEGATHRON = 641;
const ORCA = 28606;

describeEachDialect('passages, rolling and the sweeper over HTTP', (t) => {
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
    const send = (method: string, path: string, json?: unknown) =>
      fetch(`http://${base}${path}`, {
        method,
        headers: { cookie, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
    const call = async <T = unknown>(method: string, path: string, json?: unknown): Promise<T> => {
      const r = await send(method, path, json);
      expect(r.status, `${method} ${path}: ${r.status === 204 ? '' : await r.clone().text()}`).toBeLessThan(
        300,
      );
      const text = await r.text();
      return (text ? JSON.parse(text) : undefined) as T;
    };
    const status = async (method: string, path: string, json?: unknown) =>
      (await send(method, path, json)).status;
    return { me, cookie, call, status };
  };

  it('finds ships by name, logs jumps, sets them hot, plans a roll and reads the history', async () => {
    const alice = await signIn('alice');
    const ships = await alice.call<ShipTypeDto[]>('GET', '/api/universe/ships?q=megath');
    expect(ships[0]).toMatchObject({
      id: MEGATHRON,
      name: 'Megathron',
      mass: 98_400_000,
      propMass: 50_000_000,
    });
    const catalog = await alice.call<ShipCatalogDto>('GET', '/api/universe/ships/catalog');
    expect(catalog.modifiers).toMatchObject({ higgsPercent: 100, entanglerPercent: -80 });
    expect(catalog.suggested.map((s) => s.name)).toContain('Orca');

    const fit =
      '[Megathron, Roller]\n1600mm Rolled Tungsten Compact Plates\n500MN Y-T8 Compact Microwarpdrive\nLarge Higgs Anchor I';
    const weighed = await alice.call<FitMassDto>('POST', '/api/universe/ships/fit-mass', { fit });
    expect(weighed).toMatchObject({
      ship: { id: MEGATHRON },
      cold: 203_800_000,
      hot: 303_800_000,
      higgs: true,
    });
    expect(await alice.status('POST', '/api/universe/ships/fit-mass', { fit: 'not a fit' })).toBe(400);

    const map = await alice.call<MapDto>('POST', '/api/maps', { name: 'Chain' });
    for (const id of [C3, C2]) await alice.call('POST', `/api/maps/${map.id}/systems`, { solarSystemId: id });
    const hole = await alice.call<ConnectionDto>('POST', `/api/maps/${map.id}/connections`, {
      source: C2,
      target: C3,
    });
    const at = `/api/maps/${map.id}/connections/${hole.id}`;
    const fitted = await alice.call<RollPlanDto>('POST', `${at}/roll-plan`, {
      ships: [{ shipTypeId: MEGATHRON, fit }],
    });
    expect(fitted.crew).toEqual([
      {
        shipTypeId: MEGATHRON,
        name: 'Megathron (Roller)',
        cold: 203_800_000,
        hot: 303_800_000,
        tooHeavy: false,
      },
    ]);
    const logged = await alice.call<PassageDto[]>('POST', `${at}/passages`, {
      shipTypeId: MEGATHRON,
      direction: 'sourceToTarget',
      massMode: 'hot',
      count: 2,
    });
    expect(logged.map((p) => p.mass)).toEqual([148_400_000, 148_400_000]);
    expect(await alice.status('POST', `${at}/passages`, { shipTypeId: MEGATHRON, direction: 'up' })).toBe(
      400,
    );

    const [latest] = await alice.call<PassageDto[]>('GET', `${at}/passages`);
    const cold = await alice.call<PassageDto>('PATCH', `${at}/passages/${latest!.id}`, { massMode: 'cold' });
    expect(cold.mass).toBe(98_400_000);

    // O477 (guessed from the C2's static): 2 000 000 t, 375 000 t a jump, 16 h.
    const intel = await alice.call<ConnectionIntelDto>('GET', `${at}/intel`);
    expect(intel).toMatchObject({ wormholeType: 'O477', mass: { passages: 2, passed: 246_800_000 } });
    expect(intel.time).toMatchObject({ lifetimeHours: 16, lifetimeFrom: 'type' });

    const plan = await alice.call<RollPlanDto>('POST', `${at}/roll-plan`, {
      ships: [{ shipTypeId: MEGATHRON, count: 2 }, { shipTypeId: ORCA }],
    });
    expect(plan.result).not.toBe('impossible');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.crew.map((c) => c.name)).toEqual(['Megathron', 'Orca']);

    await alice.call('POST', `${at}/passages/reset`);
    expect((await alice.call<ConnectionIntelDto>('GET', `${at}/intel`)).mass).toMatchObject({ passages: 0 });
    await alice.call('DELETE', `${at}/passages/${latest!.id}`);
    expect(await alice.call<PassageDto[]>('GET', `${at}/passages`)).toHaveLength(1);

    const history = await alice.call<{ entries: Array<{ type: string }> }>(
      'GET',
      `/api/maps/${map.id}/connections/${hole.id}/history`,
    );
    expect(history.entries.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'connection.passage',
        'connection.passage_updated',
        'connection.passage_removed',
      ]),
    );
  });

  it('shows the sources’ passages on a composite and logs through the source that takes new objects', async () => {
    const alice = await signIn('alice');
    const carol = await signIn('carol');
    const corp = await alice.call<MapDto>('POST', '/api/maps', { name: 'Corp A' });
    for (const id of [C3, C2])
      await alice.call('POST', `/api/maps/${corp.id}/systems`, { solarSystemId: id });
    const hole = await alice.call<ConnectionDto>('POST', `/api/maps/${corp.id}/connections`, {
      source: C2,
      target: C3,
    });
    await alice.call('POST', `/api/maps/${corp.id}/connections/${hole.id}/passages`, {
      shipTypeId: ORCA,
      direction: 'sourceToTarget',
    });

    const alliance = await carol.call<MapDto>('POST', '/api/maps', { name: 'Alliance', kind: 'composite' });
    const offer = await alice.call<MapShareDto>('POST', `/api/maps/${corp.id}/shares`, {
      targetSlug: alliance.slug,
      level: 'read-write',
    });
    await carol.call('POST', `/api/maps/${alliance.id}/shares/${offer.id}/accept`, {});
    const snapshot = await carol.call<StreamSnapshotDto>(
      'GET',
      `/api/streams/${encodeURIComponent(`map:${alliance.id}`)}/snapshot`,
    );
    const merged = (snapshot.data as MapSnapshot).connections![0]!;
    const at = `/api/maps/${alliance.id}/connections/${encodeURIComponent(merged.id)}`;

    const seen = await carol.call<PassageDto[]>('GET', `${at}/passages`);
    expect(seen).toEqual([
      expect.objectContaining({
        shipName: 'Orca',
        recordedOn: 'Corp A',
        characterId: null,
        mass: 150_000_000,
      }),
    ]);
    // Read-only on the composite: it is changed where it was recorded.
    expect(
      await carol.status('PATCH', `${at}/passages/${encodeURIComponent(seen[0]!.id)}`, { massMode: 'hot' }),
    ).toBe(409);

    await carol.call('POST', `${at}/passages`, {
      shipTypeId: MEGATHRON,
      direction: 'targetToSource',
      massMode: 'hot',
    });
    const inCorp = await alice.call<PassageDto[]>(
      'GET',
      `/api/maps/${corp.id}/connections/${hole.id}/passages`,
    );
    expect(inCorp.map((p) => [p.shipName, p.from, p.to])).toEqual([
      ['Megathron', C3, C2],
      ['Orca', C2, C3],
    ]);
    await vi.waitFor(async () =>
      expect((await carol.call<ConnectionIntelDto>('GET', `${at}/intel`)).mass.passages).toBe(2),
    );
  });

  it('sweeps a hole that cannot exist any more, as the sweeper', async () => {
    const alice = await signIn('alice');
    const map = await alice.call<MapDto>('POST', '/api/maps', { name: 'Chain' });
    for (const id of [C3, C2]) await alice.call('POST', `/api/maps/${map.id}/systems`, { solarSystemId: id });
    const hole = await alice.call<ConnectionDto>('POST', `/api/maps/${map.id}/connections`, {
      source: C2,
      target: C3,
    });
    await alice.call('PATCH', `/api/maps/${map.id}/connections/${hole.id}`, { timeStatus: 'eol' });
    const sweeper = app.get(SweeperRuntime);
    expect(await sweeper.runOnce()).toMatchObject({ deleted: 0 });

    // Four hours after it was marked EOL it is gone in game; the sweeper deletes it an hour later.
    vi.useFakeTimers({ now: Date.now() + 5 * 60 * 60 * 1000 + 1000, toFake: ['Date'] });
    try {
      expect(await sweeper.runOnce()).toMatchObject({ deleted: 1 });
    } finally {
      vi.useRealTimers();
    }
    const history = await alice.call<{
      entries: Array<{ type: string; actor: { kind: string; id: string } }>;
    }>('GET', `/api/maps/${map.id}/connections/${hole.id}/history`);
    expect(history.entries[0]).toMatchObject({ type: 'connection.removed' });
  });
});
