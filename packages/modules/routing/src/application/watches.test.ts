import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  ManualClock,
  ValidationError,
  type Actor,
  type EventLog,
  type MapRole,
  type NewEvent,
} from '@darkbeacon/core';
import type { ConnectionDto, RouteWatchOpenedEvent, UniverseSystemDto } from '@darkbeacon/shared';
import { WATCH_CLOSE_AFTER_MS } from '../domain/watches.js';
import type { RouteWatchRecord, RouteWatchRepository, RoutingUniverse } from '../ports/index.js';
import { Router } from './router.js';
import { RouteWatches } from './watches.js';

const system = (id: number, name: string, security: number, whClass: number): UniverseSystemDto => ({
  id,
  name,
  regionName: 'Domain',
  constellationName: 'C',
  security,
  whClass,
  statics: [],
  effect: null,
});

const AMARR = 1;
const HS1 = 2;
const MOUTH_HS = 3;
const MOUTH_LS = 4;
const HOME = 100;
const W2 = 101;
const J_ELSEWHERE = 102;

/**
 * Amarr has two ways into the chain: one gate to a low-sec mouth with a hole to Home (2 jumps),
 * or two high-sec gates to a high-sec mouth, then two holes to Home (4 jumps).
 */
const SYSTEMS = [
  system(AMARR, 'Amarr', 1, 7),
  system(HS1, 'Ashab', 0.8, 7),
  system(MOUTH_HS, 'Niarja', 0.7, 7),
  system(MOUTH_LS, 'Kehour', 0.3, 8),
  system(HOME, 'J014348', -1, 3),
  system(W2, 'J100001', -1, 3),
  system(J_ELSEWHERE, 'J100002', -1, 3),
];
const GATES: Record<number, number[]> = {
  [AMARR]: [HS1, MOUTH_LS],
  [HS1]: [AMARR, MOUTH_HS],
  [MOUTH_HS]: [HS1],
  [MOUTH_LS]: [AMARR],
};
const universe: RoutingUniverse = {
  getSystem: (id) => SYSTEMS.find((s) => s.id === id) ?? null,
  systems: () => SYSTEMS,
  gateNeighbours: (id) => GATES[id] ?? [],
};

const hole = (id: string, source: number, target: number, eol = false) =>
  ({
    id,
    source,
    target,
    type: 'wormhole',
    timeStatus: eol ? 'eol' : 'normal',
    massStatus: 'normal',
    shipSize: 'large',
    dangerous: false,
    bubbled: false,
  }) as unknown as ConnectionDto;

class MemoryWatches implements RouteWatchRepository {
  rows: RouteWatchRecord[] = [];
  async list(mapId: string) {
    return this.rows.filter((w) => w.mapId === mapId).map((w) => structuredClone(w));
  }
  async find(mapId: string, id: string) {
    return (await this.list(mapId)).find((w) => w.id === id) ?? null;
  }
  async insert(watch: RouteWatchRecord) {
    this.rows.push(structuredClone(watch));
  }
  async save(watch: RouteWatchRecord) {
    this.rows = this.rows.map((w) => (w.id === watch.id ? structuredClone(watch) : w));
  }
  async remove(mapId: string, id: string) {
    this.rows = this.rows.filter((w) => !(w.mapId === mapId && w.id === id));
  }
  async mapsWithWatches() {
    return [...new Set(this.rows.map((w) => w.mapId))];
  }
  async forgetMap(mapId: string) {
    this.rows = this.rows.filter((w) => w.mapId !== mapId);
  }
}

const account = (id: string): Actor => ({ kind: 'account', id, instanceRole: 'user' });
const PILOT = account('pilot');
const OTHER = account('other');
const ADMIN = account('admin');
const VIEWER = account('viewer');
const ROLES: Record<string, MapRole> = { pilot: 'member', other: 'member', admin: 'admin', viewer: 'viewer' };
const MIN = 60_000;

function setup() {
  const connections: ConnectionDto[] = [
    hole('c1', HOME, MOUTH_LS),
    hole('c2', HOME, W2),
    hole('c3', W2, MOUTH_HS),
  ];
  let home: number | null = HOME;
  const router = new Router({
    universe,
    chains: {
      chain: async () => ({
        systems: [HOME, W2, MOUTH_HS, MOUTH_LS, J_ELSEWHERE].map((id) => ({
          solarSystemId: id,
          visible: true,
          ...(id === home ? { status: 'home' as const } : {}),
        })),
        connections,
      }),
    },
  });
  const watches = new MemoryWatches();
  const events: NewEvent[] = [];
  const clock = new ManualClock(Date.UTC(2026, 10, 21, 12));
  let next = 0;
  const service = new RouteWatches({
    watches,
    router,
    universe,
    accounts: { names: async (ids) => new Map(ids.map((id) => [id, id === 'pilot' ? 'Pilot' : id])) },
    access: {
      roleOf: async (actor) => ROLES[actor.id] ?? null,
      mapsFor: async () => [],
    },
    events: {
      append: async (list: readonly NewEvent[]) => {
        events.push(...list);
        return [];
      },
    } as unknown as EventLog,
    uow: { transaction: (work) => work() },
    clock,
    newId: () => `w${++next}`,
  });
  /** Changes the chain the way a map edit would, then looks at the watches. */
  const change = async (edit: () => void) => {
    edit();
    router.invalidate('m');
    await service.evaluate('m');
  };
  const typed = (type: string) => events.filter((e) => e.type === type);
  return {
    service,
    watches,
    events,
    typed,
    clock,
    connections,
    change,
    setHome: (id: number | null) => (home = id),
  };
}

describe('way-home watches', () => {
  it('in high-sec mode leaves out the low-sec gate and finds the high-sec mouth', async () => {
    const { service, typed } = setup();
    await service.create(PILOT, 'm', { solarSystemId: AMARR, maxJumps: 10, mode: 'highsec', hours: 24 });
    await service.create(OTHER, 'm', { solarSystemId: AMARR, maxJumps: 10, mode: 'shortest', hours: 24 });
    await service.evaluate('m');
    const opened = typed('routes.watch_opened').map((e) => e.data as RouteWatchOpenedEvent);
    expect(opened.map((o) => [o.watch.mode, o.route.mouth.name, o.route.jumps, o.change])).toEqual([
      ['highsec', 'Niarja', 4, 'opened'],
      ['shortest', 'Kehour', 2, 'opened'],
    ]);
    expect(opened[0]).toMatchObject({
      route: { gates: 2, wormholeJumps: 2, mouth: { solarSystemId: MOUTH_HS, security: 0.7 } },
      home: { solarSystemId: HOME, name: 'J014348' },
      watch: { accountId: 'pilot', ownerName: 'Pilot', target: { name: 'Amarr' } },
    });
  });

  it('counts the whole trip against the limit', async () => {
    const { service, typed } = setup();
    await service.create(PILOT, 'm', { solarSystemId: AMARR, maxJumps: 3, mode: 'highsec', hours: 24 });
    await service.evaluate('m');
    // Two gates to the mouth fit; with the two holes after it the trip is four.
    expect(typed('routes.watch_opened')).toEqual([]);
  });

  it('does not route through an end-of-life hole', async () => {
    const { service, typed, connections, change } = setup();
    await service.create(PILOT, 'm', { solarSystemId: AMARR, maxJumps: 10, mode: 'highsec', hours: 24 });
    await change(() => (connections[2] = hole('c3', W2, MOUTH_HS, true)));
    expect(typed('routes.watch_opened')).toEqual([]);
    await change(() => (connections[2] = hole('c3', W2, MOUTH_HS)));
    expect(typed('routes.watch_opened')).toHaveLength(1);
  });

  it('closes after five minutes gone, quietly comes back, and is remembered across looks', async () => {
    const { service, typed, connections, change, clock, watches } = setup();
    await service.create(PILOT, 'm', { solarSystemId: AMARR, maxJumps: 10, mode: 'highsec', hours: 24 });
    await service.evaluate('m');
    expect(typed('routes.watch_opened')).toHaveLength(1);
    expect(watches.rows[0]!.route).toMatchObject({ jumps: 4, mouth: { name: 'Niarja' } });

    // The hole to the mouth is deleted; a minute later it is mapped again: nothing posted.
    await change(() => connections.splice(2, 1));
    clock.advance(MIN);
    await change(() => connections.push(hole('c4', W2, MOUTH_HS)));
    expect(typed('routes.watch_closed')).toEqual([]);
    expect(typed('routes.watch_opened')).toHaveLength(1);

    // Gone for good: closed only once five minutes passed (the minute timer sees it).
    await change(() => connections.splice(2, 1));
    clock.advance(WATCH_CLOSE_AFTER_MS - 1);
    await service.tick();
    expect(typed('routes.watch_closed')).toEqual([]);
    clock.advance(1);
    await service.tick();
    expect(typed('routes.watch_closed').map((e) => e.data)).toMatchObject([
      { mouth: { name: 'Niarja' }, home: { name: 'J014348' } },
    ]);
    expect(watches.rows[0]!.route).toBeNull();

    // The same mouth back within 15 minutes: said, without a ping.
    clock.advance(2 * MIN);
    await change(() => connections.push(hole('c5', W2, MOUTH_HS)));
    expect((typed('routes.watch_opened').at(-1)!.data as RouteWatchOpenedEvent).change).toBe('again');

    // Looking again with nothing changed writes and says nothing.
    const count = typed('routes.watch_opened').length + typed('routes.watch_closed').length;
    await service.tick();
    expect(typed('routes.watch_opened').length + typed('routes.watch_closed').length).toBe(count);
  });

  it('without a Home the way is missing; the watch ends when it expires', async () => {
    const { service, typed, clock, setHome, change, watches } = setup();
    await change(() => setHome(null));
    await service.create(PILOT, 'm', { solarSystemId: AMARR, maxJumps: 10, mode: 'highsec', hours: 1 });
    await service.evaluate('m');
    expect(typed('routes.watch_opened')).toEqual([]);
    expect((await service.list(PILOT, 'm')).home).toBeNull();
    clock.advance(60 * MIN);
    await service.tick();
    expect(typed('routes.watch_removed').map((e) => [e.data, e.actor])).toEqual([
      [
        { id: 'w1', accountId: 'pilot', reason: 'expired' },
        { kind: 'system', id: 'routing' },
      ],
    ]);
    expect(watches.rows).toEqual([]);
  });

  it('lets members manage their own watches and admins remove anyone’s', async () => {
    const { service, typed } = setup();
    await expect(
      service.create(VIEWER, 'm', { solarSystemId: AMARR, maxJumps: 10, mode: 'highsec', hours: 24 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.create(PILOT, 'm', { solarSystemId: HOME, maxJumps: 10, mode: 'highsec', hours: 24 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const mine = await service.create(PILOT, 'm', {
      solarSystemId: AMARR,
      maxJumps: 10,
      mode: 'highsec',
      hours: 24,
    });
    expect(typed('routes.watch_added')).toHaveLength(1);
    // A second watch from the same system replaces the first.
    const again = await service.create(PILOT, 'm', {
      solarSystemId: AMARR,
      maxJumps: 8,
      mode: 'highsec',
      hours: 24,
    });
    expect(typed('routes.watch_removed').map((e) => e.data)).toEqual([
      { id: mine.id, accountId: 'pilot', reason: 'removed' },
    ]);
    expect((await service.list(PILOT, 'm')).watches.map((w) => [w.id, w.maxJumps])).toEqual([[again.id, 8]]);

    // Others do not see it and may not remove it; a map admin sees and removes it.
    expect((await service.list(OTHER, 'm')).watches).toEqual([]);
    await expect(service.remove(OTHER, 'm', again.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await service.list(ADMIN, 'm')).watches.map((w) => w.ownerName)).toEqual(['Pilot']);
    await service.remove(ADMIN, 'm', again.id);
    expect(typed('routes.watch_removed').at(-1)).toMatchObject({
      data: { id: again.id, reason: 'removed' },
      before: { target: { name: 'Amarr' } },
    });
    expect((await service.list(PILOT, 'm')).watches).toEqual([]);
  });

  it('keeps at most five watches per member and map', async () => {
    const { service } = setup();
    for (const id of [AMARR, HS1, MOUTH_HS, MOUTH_LS]) {
      await service.create(PILOT, 'm', { solarSystemId: id, maxJumps: 10, mode: 'highsec', hours: 24 });
    }
    SYSTEMS.push(system(5, 'Sarum Prime', 1, 7));
    await service.create(PILOT, 'm', { solarSystemId: 5, maxJumps: 10, mode: 'highsec', hours: 24 });
    SYSTEMS.push(system(6, 'Kador Prime', 1, 7));
    await expect(
      service.create(PILOT, 'm', { solarSystemId: 6, maxJumps: 10, mode: 'highsec', hours: 24 }),
    ).rejects.toThrow(/remove one first/);
    SYSTEMS.splice(-2);
  });
});
