import { beforeEach, expect, it } from 'vitest';
import { mapStream, NotFoundError, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  groupAttackers,
  HOUR,
  IntelJobs,
  IntelNames,
  IntelQueries,
  type IntelPublisher,
  type KillFeed,
  type Killmail,
  type KillParty,
  type NameResolver,
  type SourceResult,
} from '@darkbeacon/intel';
import { MapUseCases, SystemUseCases, type ChainMap } from '@darkbeacon/mapping';
import type { SystemIntelDto } from '@darkbeacon/shared';
import { account, mappingTestPorts } from '../mapping/testing.js';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { KyselyIntelRepository } from './kysely-intel-repository.js';
import { CatalogIntelUniverse, MappingIntelSystems } from './server-ports.js';

const universe = StaticUniverseCatalog.load('/nonexistent');
const S = {
  jita: 30000142,
  oneDq: 30004759, // 1DQ1-A, null-sec in Delve
  dpnp: 30003135, // D-PNP9, null-sec
  hole: 31002531, // J014348, C3
} as const;
const NOW = Date.UTC(2026, 9, 12, 14, 30);
const alice = account('alice');
const bob = account('bob');

const party = (corp: number, alliance: number | null, ship: number | null = null): KillParty => ({
  characterId: 90000000 + (corp % 1000),
  corporationId: corp,
  allianceId: alliance,
  factionId: null,
  shipTypeId: ship,
});

function kill(
  id: number,
  systemId: number,
  time: number,
  attackers: KillParty[] = [party(98000002, 99000002)],
): Killmail {
  return {
    id,
    hash: `h${id}`,
    systemId,
    time,
    value: 25_000_000,
    npc: false,
    solo: attackers.length === 1,
    victim: party(98000001, 99000001, 587),
    finalBlow: attackers[0] ?? null,
    attackerCount: attackers.length,
    attackers: groupAttackers(attackers),
  };
}

/** ESI's names, as far as the tests need them. */
class FakeNames implements NameResolver {
  calls = 0;
  async names(ids: readonly number[]) {
    this.calls += 1;
    return ids.map((id) => ({
      id,
      name: `Name ${id}`,
      category:
        id >= 99_000_000
          ? 'alliance'
          : id >= 98_000_000
            ? 'corporation'
            : id >= 90_000_000
              ? 'character'
              : id >= 500_000 && id < 600_000
                ? 'faction'
                : 'inventory_type',
    }));
  }
  async ticker(_category: 'corporation' | 'alliance', id: number) {
    return `T${id % 1000}`;
  }
}

class FakeFeed implements KillFeed {
  handlers: Parameters<KillFeed['start']>[0] | null = null;
  start(handlers: Parameters<KillFeed['start']>[0]) {
    this.handlers = handlers;
  }
  async stop() {}
  async push(...kills: Killmail[]) {
    this.handlers!.onAlive();
    for (const k of kills) await this.handlers!.onKill(k);
  }
}

class FakePublisher implements IntelPublisher {
  followed: string[] = [];
  pushes: Array<{ mapId: string; systems: SystemIntelDto[] }> = [];
  followedMaps() {
    return this.followed;
  }
  push(mapId: string, update: { systems: SystemIntelDto[] }) {
    this.pushes.push({ mapId, ...update });
  }
}

const ok = <T>(data: T, nextAt = NOW + HOUR): SourceResult<T> => ({ ok: true, data, nextAt });

describeEachDialect('intel repository', (ctx) => {
  let repo: KyselyIntelRepository;
  beforeEach(() => {
    repo = new KyselyIntelRepository(ctx.db);
  });

  it('replaces claims and says which systems changed', async () => {
    const alliance = { kind: 'alliance' as const, allianceId: 99000001, corporationId: 98000001 };
    expect(
      await repo.replaceClaims(
        [
          { systemId: S.oneDq, claim: alliance },
          { systemId: S.dpnp, claim: { kind: 'faction', factionId: 500019 } },
        ],
        NOW,
      ),
    ).toEqual([S.oneDq, S.dpnp]);
    expect(await repo.replaceClaims([{ systemId: S.oneDq, claim: alliance }], NOW)).toEqual([S.dpnp]);
    expect(await repo.claims([S.oneDq, S.dpnp])).toEqual(new Map([[S.oneDq, alliance]]));
  });

  it('keeps hourly figures per kind and the hours ESI answered', async () => {
    const hour = Date.UTC(2026, 9, 12, 13);
    await repo.saveHour('kills', hour, [{ systemId: S.jita, shipKills: 3, podKills: 1, npcKills: 9 }]);
    await repo.saveHour('jumps', hour, [{ systemId: S.jita, jumps: 2000 }]);
    await repo.saveHour('kills', hour, [{ systemId: S.jita, shipKills: 4, podKills: 1, npcKills: 9 }]);
    expect(await repo.activity([S.jita], hour)).toEqual([
      { systemId: S.jita, hour, shipKills: 4, podKills: 1, npcKills: 9, jumps: 2000 },
    ]);
    expect(await repo.answeredHours(hour)).toEqual({ kills: new Set([hour]), jumps: new Set([hour]) });
    await repo.pruneActivity(hour + 1);
    expect(await repo.activity([S.jita], 0)).toEqual([]);
  });

  it('stores a killmail once, counts per system and prunes by age', async () => {
    const a = kill(1, S.hole, NOW - 10 * 60_000);
    const b = kill(2, S.hole, NOW - 2 * HOUR);
    expect((await repo.addKills([a, b, a])).map((k) => k.id)).toEqual([1, 2]);
    expect(await repo.addKills([a])).toEqual([]);
    expect(await repo.kills(S.hole, 0)).toEqual([a, b]);
    expect(await repo.killsIn([S.hole, S.jita], NOW - HOUR, 10)).toEqual([a]);
    expect(await repo.killCounts([S.hole], NOW - HOUR)).toEqual(
      new Map([[S.hole, { count: 1, last: a.time }]]),
    );
    expect(await repo.lastKills([S.hole, S.jita])).toEqual(new Map([[S.hole, a.time]]));
    await repo.pruneKills(NOW - HOUR);
    expect((await repo.kills(S.hole, 0)).map((k) => k.id)).toEqual([1]);
  });

  it('keeps coverage, names with or without a looked-up ticker, and small state', async () => {
    await repo.setCoverage(S.hole, { since: 1, at: 2 });
    expect(await repo.coverage([S.hole, S.jita])).toEqual(new Map([[S.hole, { since: 1, at: 2 }]]));
    await repo.dropCoverage([S.hole]);
    expect((await repo.coverage([S.hole])).size).toBe(0);
    await repo.saveNames([
      { id: 99000001, name: 'Alliance', category: 'alliance', updatedAt: 5 },
      { id: 98000001, name: 'Corp', category: 'corporation', ticker: null, updatedAt: 5 },
    ]);
    const names = await repo.names([99000001, 98000001, 1]);
    expect(names.get(99000001)).toEqual({
      id: 99000001,
      name: 'Alliance',
      category: 'alliance',
      updatedAt: 5,
    });
    expect(names.get(98000001)?.ticker).toBeNull();
    await repo.setStandingOverride('alice', 99000001, -10, 1);
    await repo.setStandingOverride('alice', 99000001, -5, 2);
    await repo.setStandingOverride('bob', 99000001, 10, 2);
    expect(await repo.standingOverrides('alice')).toEqual(new Map([[99000001, -5]]));
    await repo.setStandingOverride('alice', 99000001, null, 3);
    expect((await repo.standingOverrides('alice')).size).toBe(0);
    await repo.setState('r2z2', { sequence: 5, at: 1 });
    expect(await repo.state('r2z2')).toEqual({ sequence: 5, at: 1 });
    expect(await repo.state('missing')).toBeNull();
  });
});

describeEachDialect('intel jobs and queries', (ctx) => {
  let env: ReturnType<typeof mappingTestPorts>;
  let repo: KyselyIntelRepository;
  let map: ChainMap;
  let other: ChainMap;
  let systems: SystemUseCases;
  let feed: FakeFeed;
  let publisher: FakePublisher;
  let queries: IntelQueries;
  let jobs: IntelJobs;
  let events: DomainEvent[];
  let history: Map<number, Killmail[]>;
  let historyCalls: number[];

  beforeEach(async () => {
    env = mappingTestPorts(ctx.db);
    env.ports.universe = universe;
    env.clock.set(NOW);
    repo = new KyselyIntelRepository(ctx.db);
    map = await new MapUseCases(env.ports).create(alice, { name: 'Chain' });
    other = await new MapUseCases(env.ports).create(bob, { name: 'Other' });
    systems = new SystemUseCases(env.ports);
    for (const id of [S.hole, S.oneDq, S.jita]) await systems.add(alice, map.id, { solarSystemId: id });
    await systems.add(bob, other.id, { solarSystemId: S.hole });
    await systems.update(bob, other.id, S.hole, { visible: false });
    events = [];
    env.bus.subscribe((e) => void events.push(e));
    feed = new FakeFeed();
    publisher = new FakePublisher();
    history = new Map();
    historyCalls = [];
    let live = () => false;
    queries = new IntelQueries({
      repo,
      names: new IntelNames({ repo, resolver: new FakeNames(), clock: env.clock }),
      systems: new MappingIntelSystems(ctx.db, env.ports),
      universe: new CatalogIntelUniverse(universe),
      access: env.access,
      clock: env.clock,
      live: () => live(),
    });
    jobs = new IntelJobs({
      repo,
      queries,
      systems: new MappingIntelSystems(ctx.db, env.ports),
      publisher,
      events: env.ports.events,
      clock: env.clock,
      feed,
      history: {
        recent: async (systemId) => {
          historyCalls.push(systemId);
          return ok({ kills: history.get(systemId) ?? [], capped: false }, NOW);
        },
      },
      sovereignty: {
        claims: async () =>
          ok([
            { systemId: S.oneDq, claim: { kind: 'alliance', allianceId: 99000001, corporationId: 98000001 } },
            { systemId: S.jita, claim: { kind: 'faction', factionId: 500001 } },
          ]),
      },
      activity: {
        systemKills: async () =>
          ok({
            hour: Date.UTC(2026, 9, 12, 13),
            rows: [{ systemId: S.oneDq, shipKills: 6, podKills: 2, npcKills: 120 }],
          }),
        systemJumps: async () =>
          ok({ hour: Date.UTC(2026, 9, 12, 13), rows: [{ systemId: S.oneDq, jumps: 40 }] }),
      },
    });
    live = () => jobs.live();
    await jobs.start();
  });

  it('fetches sovereignty and the hourly figures once, and tells viewers of maps holding the systems', async () => {
    publisher.followed = [map.id, other.id];
    await jobs.tick();
    const intel = await queries.mapIntel(alice, map.id);
    const delve = intel.systems.find((s) => s.solarSystemId === S.oneDq)!;
    expect(delve).toMatchObject({
      sovereignty: {
        kind: 'alliance',
        holder: { id: 99000001, name: 'Name 99000001', ticker: 'T1' },
        corporation: { id: 98000001, name: 'Name 98000001' },
      },
      kills1h: 8,
      npcKills1h: 120,
      jumps1h: 40,
    });
    // Empire factions are not shown; wormholes have no sovereignty.
    expect(intel.systems.find((s) => s.solarSystemId === S.jita)!.sovereignty).toBeNull();
    expect(intel.systems.find((s) => s.solarSystemId === S.hole)!.sovereignty).toBeNull();
    const pushed = publisher.pushes
      .filter((p) => p.mapId === map.id)
      .flatMap((p) => p.systems.map((s) => s.solarSystemId));
    expect(pushed).toContain(S.oneDq);
    expect(
      publisher.pushes.some(
        (p) => p.mapId === other.id && p.systems.some((s) => s.solarSystemId === S.oneDq),
      ),
    ).toBe(false);
  });

  it('fetches the history of every system once, then counts live killmails and reports them where the system shows', async () => {
    history.set(S.hole, [kill(1, S.hole, NOW - 3 * HOUR), kill(2, S.hole, NOW - 30 * 60_000)]);
    for (let i = 0; i < 4; i++) {
      await jobs.tick();
      env.clock.advance(2_000);
    }
    expect(historyCalls.sort()).toEqual([S.jita, S.hole, S.oneDq].sort());
    expect(
      (await queries.mapIntel(alice, map.id)).systems.find((s) => s.solarSystemId === S.hole)!.kills1h,
    ).toBe(1);

    publisher.followed = [map.id];
    events.length = 0;
    await feed.push(kill(3, S.hole, env.clock.now() - 60_000), kill(4, 30002187, env.clock.now()));
    expect(jobs.live()).toBe(true);
    const reported = events.filter((e) => e.type === 'kill.reported');
    // Only the map showing the system: the other map hides it, Amarr is on no map.
    expect(reported.map((e) => e.stream)).toEqual([mapStream(map.id)]);
    expect(reported[0]!.data).toMatchObject({
      id: 3,
      solarSystemId: S.hole,
      victim: { ship: { id: 587, name: 'Name 587' } },
    });
    expect(reported[0]!.actor).toEqual({ kind: 'system', id: 'intel' });
    const hole = (await queries.mapIntel(alice, map.id)).systems.find((s) => s.solarSystemId === S.hole)!;
    expect(hole.kills1h).toBe(2);
    expect(publisher.pushes.at(-1)).toMatchObject({
      mapId: map.id,
      systems: [{ solarSystemId: S.hole, kills1h: 2 }],
    });

    // A late killmail (catching up) is stored but not reported.
    events.length = 0;
    await feed.push(kill(5, S.hole, env.clock.now() - 2 * HOUR));
    expect(events.filter((e) => e.type === 'kill.reported')).toEqual([]);
  });

  it('lists a system on the map with its hours, killmails and who is active, for viewers only', async () => {
    await repo.addKills([
      kill(1, S.hole, NOW - 20 * 60_000, [party(98000002, 99000002), party(98000003, null)]),
      kill(2, S.hole, NOW - 5 * HOUR),
    ]);
    await repo.setCoverage(S.hole, { since: NOW - 7 * 24 * HOUR, at: NOW });
    const activity = await queries.systemActivity(alice, map.id, S.hole);
    expect(activity.hours).toHaveLength(24);
    // Wormhole space: no ESI figures, the killmails per hour instead.
    const fifthHour = activity.hours.find((h) => h.hour === Math.floor((NOW - 5 * HOUR) / HOUR) * HOUR)!;
    expect(fifthHour).toMatchObject({ shipKills: null, npcKills: null, jumps: null, killmails: 1 });
    expect(activity.hours.filter((h) => (h.killmails ?? 0) > 0)).toHaveLength(1);
    expect(activity.kills.map((k) => k.id)).toEqual([1, 2]);
    expect(activity.kills[0]).toMatchObject({
      value: 25_000_000,
      victim: { alliance: { id: 99000001, ticker: 'T1' } },
      attackers: [{ alliance: { id: 99000002, ticker: 'T2' }, pilots: 1 }, { corporation: { id: 98000003 } }],
    });
    expect(activity.groups['1h'].map((g) => [g.entity.id, g.kills, g.losses])).toEqual([
      [98000003, 1, 0],
      [99000002, 1, 0],
      [99000001, 0, 1],
    ]);
    expect(activity.groups['24h'][0]).toMatchObject({ kind: 'alliance', entity: { id: 99000002 }, kills: 2 });

    await expect(queries.systemActivity(bob, map.id, S.hole)).rejects.toBeInstanceOf(NotFoundError);
    await expect(queries.systemActivity(alice, map.id, 30002187)).rejects.toBeInstanceOf(NotFoundError);
    await expect(queries.mapIntel(bob, map.id)).rejects.toBeInstanceOf(NotFoundError);

    const kills = await queries.mapKills(alice, map.id, { hours: 24, limit: 50, wormholes: true });
    expect(kills.kills.map((k) => k.id)).toEqual([1, 2]);
    expect(
      (await queries.mapKills(alice, map.id, { hours: 1, limit: 50, systems: [S.hole] })).kills,
    ).toHaveLength(1);
    expect(
      (await queries.mapKills(alice, map.id, { hours: 24, limit: 50, systems: [S.jita] })).kills,
    ).toEqual([]);
  });
});
