import { beforeEach, describe, expect, it } from 'vitest';
import { mapStream } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ConnectionUseCases, MapUseCases, SystemUseCases, type ChainMap } from '@darkbeacon/mapping';
import {
  closedLevels,
  displaySecurity,
  ExitsPublisher,
  findRoute,
  HubAdmin,
  isHighSecSpace,
  policyFor,
  policeAttack,
  RouteGraph,
  RouteQueries,
  Router,
  type PilotDirectory,
} from '@darkbeacon/routing';
import type { RouteMode } from '@darkbeacon/shared';
import { account, mappingTestPorts } from '../mapping/testing.js';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { MappingChainSource } from './esi-adapters.js';
import { KyselyHubRepository } from './kysely-hub-repository.js';

const universe = StaticUniverseCatalog.load('/nonexistent');

const S = {
  jita: 30000142,
  amarr: 30002187,
  dodixie: 30002659,
  rens: 30002510,
  hek: 30002053,
  perimeter: 30000144,
  nourvukaiken: 30001376,
  tama: 30002813,
  amamake: 30002537,
  rancer: 30002718,
  home: 31002531, // J014348, C3, statics D845 (HS) and U210 (LS)
  c2: 31000399, // J130256, C2, statics B274 (HS) and O477 (C3)
} as const;

describe('route engine on the real universe', () => {
  const graph = new RouteGraph(new Router({ universe, chains: { chain: async () => null } }).base);
  const jumps = (from: number, to: number, mode: RouteMode = 'shortest', closed = 0) => {
    const steps = findRoute(graph, from, to, policyFor(mode, closed));
    return steps ? steps.length - 1 : null;
  };
  const path = (from: number, to: number, mode: RouteMode, closed = 0) =>
    (findRoute(graph, from, to, policyFor(mode, closed)) ?? []).map((s) => universe.getSystem(s.id)!);

  it('matches the jump counts ESI gives for the shortest routes between trade hubs', () => {
    // POST https://esi.evetech.net/route/{origin}/{destination} with preference Shorter, 2026-10-12.
    expect(jumps(S.jita, S.amarr)).toBe(11);
    expect(jumps(S.jita, S.dodixie)).toBe(12);
    expect(jumps(S.jita, S.rens)).toBe(15);
    expect(jumps(S.jita, S.hek)).toBe(9);
    expect(jumps(S.jita, S.perimeter)).toBe(1);
    expect(jumps(S.jita, S.jita)).toBe(0);
  });

  it('never routes through Zarzakh, although ESI routes do', () => {
    // GET https://esi.evetech.net/route/30002086/30003841/ answers Turnur, Zarzakh, Alsavoinon
    // (2026-10-12), but a ship entering Zarzakh by gate may only leave by that gate for 6 hours.
    const turnur = 30002086;
    const alsavoinon = 30003841;
    const zarzakh = 30100000;
    expect(universe.gateNeighbours(zarzakh)).toEqual([30001041, 30001269, turnur, alsavoinon]);
    const route = path(turnur, alsavoinon, 'shortest');
    expect(route.length - 1).toBeGreaterThan(2);
    expect(route.map((s) => s.id)).not.toContain(zarzakh);
    expect(jumps(turnur, zarzakh)).toBe(1);
    expect(jumps(zarzakh, alsavoinon)).toBe(1);
  });

  it('keeps high-sec only routes in high-sec and they are never shorter', () => {
    const route = path(S.jita, S.amarr, 'highsec');
    // The fewest jumps through true security >= 0.45 only (an independent breadth-first search over
    // the same data agrees). ESI's "Safer" preference takes 45: it also weighs security inside
    // high-sec, so it is no reference for this mode.
    expect(route.length - 1).toBe(34);
    expect(jumps(S.jita, S.amarr, 'highsec')).toBeGreaterThan(jumps(S.jita, S.amarr)!);
    expect(route.every((s) => isHighSecSpace(s))).toBe(true);
    expect(path(S.jita, S.amarr, 'safer').every((s) => isHighSecSpace(s))).toBe(true);
  });

  it('never takes an outlaw into high-sec (true security 0.45 and up)', () => {
    expect(jumps(S.jita, S.tama, 'outlaw')).toBeNull(); // every gate out of Jita leads to high-sec
    const route = path(S.tama, S.amamake, 'outlaw');
    expect(route.length).toBeGreaterThan(2);
    expect(route.every((s) => s.security < 0.45)).toBe(true);
    expect(jumps(S.tama, S.jita, 'outlaw')).toBeNull();
  });

  it('keeps a pilot out of the systems where faction police attack them', () => {
    for (const status of [-2.0, -3.2, -4.6]) {
      const closed = closedLevels(status);
      const route = path(S.rancer, S.jita, 'pilot', closed);
      expect(
        route.slice(1).every((s) => !policeAttack(s.security, status)),
        String(status),
      ).toBe(true);
    }
    // A pilot in good standing goes the shortest way.
    expect(jumps(S.jita, S.amarr, 'pilot', closedLevels(1.5))).toBe(11);
    // Jita shows 0.9: closed from -2.5 down.
    expect(displaySecurity(universe.getSystem(S.jita)!.security)).toBe(0.9);
    expect(jumps(S.rancer, S.jita, 'pilot', closedLevels(-2.4))).not.toBeNull();
    expect(jumps(S.rancer, S.jita, 'pilot', closedLevels(-2.5))).toBeNull();
  });
});

const alice = account('alice');
const bob = account('bob');

const pilots: PilotDirectory = {
  ownerOf: async (id) => (id === 9001 ? 'alice' : null),
  securityStatus: async () => -5,
  scopes: async () => [],
  accessToken: async () => null,
  charactersOf: async () => [],
};

describeEachDialect('routing over a map', (t) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let map: ChainMap;
  let router: Router;
  let queries: RouteQueries;
  let hubs: HubAdmin;
  let publisher: ExitsPublisher;
  let systems: SystemUseCases;
  let connections: ConnectionUseCases;

  beforeEach(async () => {
    env = mappingTestPorts(t.db);
    env.ports.universe = universe;
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    env.access.grant('bob', map.id, 'viewer');
    systems = new SystemUseCases(env.ports);
    connections = new ConnectionUseCases(env.ports);
    router = new Router({ universe, chains: new MappingChainSource(env.ports) });
    const repo = new KyselyHubRepository(t.db);
    queries = new RouteQueries({ router, universe, hubs: repo, pilots, access: env.access });
    hubs = new HubAdmin({
      hubs: repo,
      queries,
      universe,
      access: env.access,
      events: env.ports.events,
      uow: t.db,
      clock: env.clock,
    });
    publisher = new ExitsPublisher({ queries, events: env.ports.events, clock: env.clock });
    for (const id of [S.home, S.tama, S.c2]) await systems.add(alice, map.id, { solarSystemId: id });
    await connections.add(alice, map.id, { source: S.home, target: S.tama });
    await connections.add(alice, map.id, { source: S.home, target: S.c2 });
    router.invalidate(map.id);
  });

  const eventsOf = async (type: string) =>
    (await env.ports.events.readSince(mapStream(map.id), 0)).filter((e) => e.type === type);

  it('routes out of the chain through its wormholes', async () => {
    const route = await queries.route(bob, map.id, { from: S.c2, to: S.jita, mode: 'shortest' });
    expect(route.steps.slice(0, 3).map((s) => [s.name, s.via])).toEqual([
      ['J130256', 'start'],
      ['J014348', 'wormhole'],
      ['Tama', 'wormhole'],
    ]);
    expect(route.steps[1]).toMatchObject({ classLabel: 'C3', connectionId: expect.any(String) as string });
    expect(route.jumps).toBe(route.steps.length - 1);
    expect(route.steps.at(-1)?.name).toBe('Jita');

    // Skipping EOL connections closes the way out.
    const tamaLink = (await env.ports.connections.findBetween(map.id, S.home, S.tama))!;
    await connections.update(alice, map.id, tamaLink.id, { timeStatus: 'eol' });
    router.invalidate(map.id);
    expect(
      (await queries.route(bob, map.id, { from: S.c2, to: S.jita, mode: 'shortest', skip: ['eol'] })).jumps,
    ).toBeNull();
    expect((await queries.route(bob, map.id, { from: S.c2, to: S.jita, mode: 'shortest' })).jumps).toBe(
      route.jumps,
    );
    // So does avoiding Tama.
    expect(
      (await queries.route(bob, map.id, { from: S.c2, to: S.jita, mode: 'shortest', avoid: [S.tama] })).jumps,
    ).toBeNull();
  });

  it('needs a security status for the pilot mode, from an own character or given', async () => {
    await expect(
      queries.route(alice, map.id, { from: S.tama, to: S.jita, mode: 'pilot' }),
    ).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      queries.route(bob, map.id, { from: S.tama, to: S.jita, mode: 'pilot', characterId: 9001 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const outlaw = await queries.route(alice, map.id, {
      from: S.tama,
      to: S.jita,
      mode: 'pilot',
      characterId: 9001,
    });
    expect(outlaw).toMatchObject({ jumps: null, securityStatus: -5 });
    const fine = await queries.route(alice, map.id, {
      from: S.tama,
      to: S.jita,
      mode: 'pilot',
      securityStatus: 0,
    });
    expect(fine.jumps).toBe(
      (await queries.route(alice, map.id, { from: S.tama, to: S.jita, mode: 'shortest' })).jumps,
    );
  });

  it('lists exits with the nearest hub, and statics that lead to known space', async () => {
    const { exits } = await queries.exits(bob, map.id, { mode: 'shortest' });
    expect(exits.map((e) => [e.kind, e.name])).toEqual([
      ['connected', 'Tama'],
      ['static', 'J014348'],
      ['static', 'J130256'],
    ]);
    const tama = exits[0]!;
    expect(tama).toMatchObject({ classLabel: 'LS', chainSystemId: S.home });
    expect(tama.nearest).toMatchObject({ kind: 'trade', name: 'Jita' });
    expect(tama.nearest!.jumps).toBe(tama.hubs[0]!.jumps);
    expect(tama.hubs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['Jita', 'Amarr', 'Dodixie', 'Rens', 'Hek']),
    );
    // U210 (low-sec) is the Tama hole, so only D845 is left open; B274 of the C2 too.
    expect(exits[1]!.statics).toEqual([{ code: 'D845', destination: 'hs' }]);
    expect(exits[2]!.statics).toEqual([{ code: 'B274', destination: 'hs' }]);
  });

  it('suggests low-sec staging systems to outlaws', async () => {
    const { exits } = await queries.exits(bob, map.id, { mode: 'outlaw' });
    const hubsOfTama = exits[0]!.hubs;
    expect(hubsOfTama.every((h) => h.kind === 'staging')).toBe(true);
    expect(hubsOfTama.map((h) => h.near?.name).sort()).toEqual(['Amarr', 'Dodixie', 'Hek', 'Jita', 'Rens']);
    for (const hub of hubsOfTama) {
      expect(hub.security).toBeLessThan(0.45);
      expect(hub.security).toBeGreaterThan(0);
      // Staging systems lie in low-sec an outlaw can reach without high-sec.
      expect(hub.jumps, hub.name).not.toBeNull();
    }
  });

  it('keeps map and personal hubs, and publishes map hub changes', async () => {
    await expect(hubs.setMapHubs(bob, map.id, [S.amamake])).rejects.toMatchObject({ code: 'forbidden' });
    expect(await hubs.setMapHubs(alice, map.id, [S.amamake, S.amamake, S.rancer])).toEqual([
      {
        solarSystemId: S.amamake,
        name: 'Amamake',
        security: expect.any(Number) as number,
        kind: 'map',
        near: null,
      },
      {
        solarSystemId: S.rancer,
        name: 'Rancer',
        security: expect.any(Number) as number,
        kind: 'map',
        near: null,
      },
    ]);
    expect((await eventsOf('routes.hubs_changed')).map((e) => e.data)).toEqual([
      { hubs: await queries.mapHubs(map.id) },
    ]);
    await expect(hubs.setMapHubs(alice, map.id, [1])).rejects.toMatchObject({ code: 'validation' });

    expect(await hubs.setPersonalHubs(bob, [S.perimeter])).toMatchObject([
      { name: 'Perimeter', kind: 'personal' },
    ]);
    const seen = await queries.hubs(bob, map.id);
    expect(seen.trade.map((h) => h.name)).toEqual(['Jita', 'Amarr', 'Dodixie', 'Rens', 'Hek']);
    expect(seen.map.map((h) => h.name)).toEqual(['Amamake', 'Rancer']);
    expect(seen.personal.map((h) => h.name)).toEqual(['Perimeter']);
    expect((await queries.hubs(alice, map.id)).personal).toEqual([]);

    const distances = await queries.hubDistances(bob, map.id, { from: S.tama, mode: 'shortest' });
    expect(distances.map((d) => d.kind)).toEqual(expect.arrayContaining(['trade', 'map', 'personal']));
    expect(distances.map((d) => d.jumps)).toEqual([...distances.map((d) => d.jumps)].sort((a, b) => a! - b!));

    await hubs.forgetMap(map.id);
    expect(await queries.mapHubs(map.id)).toEqual([]);
  });

  it('publishes exits when they change, and only then', async () => {
    expect(await publisher.refresh(map.id)).toHaveLength(3);
    expect(await publisher.refresh(map.id)).toBeNull();
    const link = (await env.ports.connections.findBetween(map.id, S.home, S.tama))!;
    await connections.remove(alice, map.id, link.id);
    router.invalidate(map.id);
    const exits = await publisher.refresh(map.id);
    expect(exits?.map((e) => e.name)).toEqual(['J014348', 'J130256']);
    expect(exits?.[0]?.statics.map((s) => s.code)).toEqual(['D845', 'U210']);
    expect((await eventsOf('routes.exits_changed')).length).toBe(2);
    expect(await queries.sharedExits(map.id)).toEqual(exits);
  });

  it('computes shared exits once per state of the chain and its hubs', async () => {
    const first = queries.sharedExits(map.id);
    expect(queries.sharedExits(map.id)).toBe(first);
    const exits = await first;
    // Hubs changed: the exits are computed again, the route tables are kept.
    router.forgetDerived(map.id);
    const again = queries.sharedExits(map.id);
    expect(again).not.toBe(first);
    expect(await again).toEqual(exits);
    // The chain changed: everything goes.
    const link = (await env.ports.connections.findBetween(map.id, S.home, S.tama))!;
    await connections.remove(alice, map.id, link.id);
    router.invalidate(map.id);
    expect((await queries.sharedExits(map.id)).map((e) => e.name)).toEqual(['J014348', 'J130256']);
  });

  it('routes to the map hubs out of a chain whose holes are all end of life', async () => {
    // A chain like the one behind "No connection" on every hub: home C3 J164751 -> C2 J110043,
    // which leads to Charmerout (high-sec) and S9X-AX (null-sec), every hole marked EOL.
    const C = { home: 31001269, c2: 31000429, charmerout: 30004976, s9x: 30003741 };
    const shck = await new MapUseCases(env.ports).create(alice, { name: 'SHCK' });
    env.access.grant('bob', shck.id, 'viewer');
    for (const id of Object.values(C)) await systems.add(alice, shck.id, { solarSystemId: id });
    for (const [a, b] of [
      [C.home, C.c2],
      [C.c2, C.charmerout],
      [C.c2, C.s9x],
    ] as const) {
      const link = await connections.add(alice, shck.id, { source: a, target: b });
      await connections.update(alice, shck.id, link.id, { timeStatus: 'eol' });
    }
    await hubs.setMapHubs(alice, shck.id, [S.jita, S.amarr, S.dodixie, S.rens, S.hek]);
    router.invalidate(shck.id);

    const fromHome = await queries.hubRoutes(bob, shck.id, { from: C.home, hubs: 'map', mode: 'shortest' });
    // Out through Charmerout: two holes, then Charmerout's seven gates to Dodixie.
    expect(fromHome.routes.map((r) => [r.name, r.jumps])).toEqual([
      ['Dodixie', 9],
      ['Jita', 13],
      ['Hek', 14],
      ['Rens', 18],
      ['Amarr', 19],
    ]);
    expect(fromHome.unreachable).toBeUndefined();
    expect(fromHome.routes[0]!.steps.slice(0, 3).map((s) => [s.name, s.via])).toEqual([
      ['J164751', 'start'],
      ['J110043', 'wormhole'],
      ['Charmerout', 'wormhole'],
    ]);
    // Skipping EOL holes leaves the home system no way out: every hub has no route.
    const noEol = await queries.hubRoutes(bob, shck.id, {
      from: C.home,
      hubs: 'map',
      mode: 'shortest',
      skip: ['eol'],
    });
    expect(noEol.routes.every((r) => r.jumps === null)).toBe(true);
    expect(noEol.unreachable).toBe('no-exit');
    // Known space reached, but the mode keeps every (high-sec) hub out of reach.
    const outlaw = await queries.hubRoutes(bob, shck.id, { from: C.home, hubs: 'map', mode: 'outlaw' });
    expect(outlaw).toMatchObject({ unreachable: 'options' });

    // Once the holes are gone (the sweeper removes expired ones), only the home is left.
    for (const id of [C.c2, C.charmerout, C.s9x]) await systems.remove(alice, shck.id, id);
    router.invalidate(shck.id);
    const alone = await queries.hubRoutes(bob, shck.id, { from: C.home, hubs: 'map', mode: 'shortest' });
    expect(alone.routes.map((r) => r.jumps)).toEqual([null, null, null, null, null]);
    expect(alone.unreachable).toBe('isolated');
  });

  it('hides routes from people who cannot see the map', async () => {
    await expect(
      queries.route(account('eve'), map.id, { from: S.tama, to: S.jita, mode: 'shortest' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(queries.exits(account('eve'), map.id, { mode: 'shortest' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
