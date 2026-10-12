import { newEvent, type DomainEvent, type MapRole } from '@darkbeacon/core';
import type { MapScope } from '@darkbeacon/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AutoMapper } from '../application/auto-mapper.js';
import type { RecordedJump, UniverseLookup } from '../ports/index.js';
import { fakeAccess, MemoryTrackingRepository } from '../test-support.js';

const JITA = 30000145; // high-sec (New Caldari; Jita itself is excluded by default)
const PERIMETER = 30000144; // high-sec, gate-linked to it
const REAL_JITA = 30000142;
const AMAMAKE = 30002537; // low-sec
const J_SPACE = 31000001; // C3
const PILOT = 90000001;

const universe: UniverseLookup = {
  getSystem: (id) =>
    ({
      [JITA]: { whClass: 7 },
      [REAL_JITA]: { whClass: 7 },
      [PERIMETER]: { whClass: 7 },
      [AMAMAKE]: { whClass: 8 },
    })[id] ?? (id >= 31000000 ? { whClass: 3 } : null),
  gateLinked: (a, b) => (a === JITA && b === PERIMETER) || (a === PERIMETER && b === JITA),
};

function jumped(mapId: string, from: number, to: number): DomainEvent {
  return {
    ...newEvent({
      stream: `map:${mapId}`,
      type: 'character.jumped',
      actor: { kind: 'system', id: 'tracking' },
      data: { characterId: PILOT, from, to, shipTypeId: 587 },
      occurredAt: 0,
    }),
    seq: 1,
    v: 1,
  };
}

describe('AutoMapper', () => {
  let tracking: MemoryTrackingRepository;
  let recorded: RecordedJump[];
  let scopes: Record<string, MapScope[]>;
  let roles: Record<string, Record<string, MapRole>>;
  let mapper: AutoMapper;

  beforeEach(() => {
    tracking = new MemoryTrackingRepository();
    tracking.tracked = [{ mapId: 'm1', characterId: PILOT, accountId: 'alice', since: 0 }];
    recorded = [];
    scopes = { m1: ['wormhole'] };
    roles = { m1: { alice: 'member' } };
    mapper = new AutoMapper({
      tracking,
      access: fakeAccess(roles),
      universe,
      target: {
        scopes: (mapId) => Promise.resolve(scopes[mapId] ?? null),
        recordJump: (jump) => {
          recorded.push(jump);
          return Promise.resolve();
        },
      },
    });
  });

  it('records a jump out of wormhole space as a wormhole connection', async () => {
    await mapper.handle(jumped('m1', J_SPACE, JITA));
    expect(recorded).toEqual([
      {
        mapId: 'm1',
        from: J_SPACE,
        to: JITA,
        type: 'wormhole',
        characterId: PILOT,
        shipTypeId: 587,
        accountId: 'alice',
      },
    ]);
  });

  it('ignores travel outside the map scopes and records gates when high-sec is in scope', async () => {
    await mapper.handle(jumped('m1', JITA, PERIMETER));
    expect(recorded).toEqual([]);
    scopes.m1 = ['wormhole', 'high'];
    await mapper.handle(jumped('m1', JITA, PERIMETER));
    await mapper.handle(jumped('m1', PERIMETER, AMAMAKE));
    expect(recorded.map((j) => j.type)).toEqual(['gate', 'wormhole']);
  });

  it('maps gate-less known-space jumps, types known bridges and leaves Jita out', async () => {
    mapper = new AutoMapper({
      tracking,
      access: fakeAccess(roles),
      universe,
      bridges: { linked: (_map, a, b) => Promise.resolve(a === AMAMAKE && b === PERIMETER) },
      target: {
        scopes: (mapId) => Promise.resolve(scopes[mapId] ?? null),
        recordJump: (jump) => {
          recorded.push(jump);
          return Promise.resolve();
        },
      },
    });
    // High-sec to low-sec without a stargate went through a wormhole.
    await mapper.handle(jumped('m1', PERIMETER, AMAMAKE));
    await mapper.handle(jumped('m1', AMAMAKE, PERIMETER));
    await mapper.handle(jumped('m1', J_SPACE, REAL_JITA));
    expect(recorded.map((j) => [j.to, j.type])).toEqual([
      [AMAMAKE, 'wormhole'],
      [PERIMETER, 'bridge'],
    ]);
  });

  it('adds where a character is found when tracking starts, in scope only', async () => {
    const placed: number[] = [];
    mapper = new AutoMapper({
      tracking,
      access: fakeAccess(roles),
      universe,
      target: {
        scopes: (mapId) => Promise.resolve(scopes[mapId] ?? null),
        recordJump: () => Promise.resolve(),
        placeSystem: (input) => {
          placed.push(input.solarSystemId);
          return Promise.resolve();
        },
      },
    });
    const event = (type: string, data: unknown) => ({ ...jumped('m1', J_SPACE, JITA), type, data });
    const presence = { characterId: PILOT, accountId: 'alice', name: 'P', shipTypeId: null, shipName: null };
    await mapper.handle(
      event('character.tracked', { ...presence, solarSystemId: J_SPACE, online: true, updatedAt: 0 }),
    );
    await mapper.handle(event('character.moved', { characterId: PILOT, from: null, to: J_SPACE + 1 }));
    // Out of scope, a later move (a jump handles those) and someone else's character: nothing.
    await mapper.handle(event('character.moved', { characterId: PILOT, from: null, to: AMAMAKE }));
    await mapper.handle(event('character.moved', { characterId: PILOT, from: J_SPACE, to: J_SPACE + 2 }));
    await mapper.handle({ ...event('character.moved', { characterId: 1, from: null, to: J_SPACE }) });
    expect(placed).toEqual([J_SPACE, J_SPACE + 1]);
  });

  it('skips characters not tracked on the map, owners without edit rights and other events', async () => {
    await mapper.handle(jumped('m2', J_SPACE, JITA));
    roles.m1!.alice = 'viewer';
    await mapper.handle(jumped('m1', J_SPACE, JITA));
    await mapper.handle({ ...jumped('m1', J_SPACE, JITA), type: 'character.moved' });
    await mapper.handle({ ...jumped('m1', J_SPACE, JITA), stream: 'instance' });
    expect(recorded).toEqual([]);
  });

  it('stops tracking on a map that no longer exists', async () => {
    delete scopes.m1;
    await mapper.handle(jumped('m1', J_SPACE, JITA));
    expect(recorded).toEqual([]);
    expect(tracking.tracked).toEqual([]);
  });

  it('records jumps of one map one after another', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));
    mapper = new AutoMapper({
      tracking,
      access: fakeAccess(roles),
      universe,
      target: {
        scopes: () => Promise.resolve(['wormhole']),
        recordJump: async (jump) => {
          order.push(`start ${jump.to}`);
          if (jump.to === JITA) await first;
          order.push(`end ${jump.to}`);
        },
      },
    });
    const a = mapper.handle(jumped('m1', J_SPACE, JITA));
    const b = mapper.handle(jumped('m1', JITA, J_SPACE));
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([a, b]);
    expect(order).toEqual([`start ${JITA}`, `end ${JITA}`, `start ${J_SPACE}`, `end ${J_SPACE}`]);
  });
});
