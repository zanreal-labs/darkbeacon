import { describe, expect, it } from 'vitest';
import type { RouteDto, RouteStepDto } from '@darkbeacon/shared';
import { buildStarModel } from './model';
import { UNIVERSE } from './fixtures.test-support';
import type { RouteHoleDto, TheraDto } from '@darkbeacon/shared';
import {
  handoverText,
  mapLegs,
  missingHoles,
  THERA,
  travelLegs,
  travelPlan,
  travelTotals,
  travelWaypointParts,
  TURNUR,
} from './travel';

const JITA = 30000142;
const IGNOITTON = 30002647;
const AHBAZON = 30005196;
const AMI = 30005035;
const J_SYSTEM = 31002531;
const DELVE = 30004759;

const step = (
  solarSystemId: number,
  via: RouteStepDto['via'],
  extra: Partial<RouteStepDto> = {},
): RouteStepDto => ({
  solarSystemId,
  name: `S${solarSystemId}`,
  security: solarSystemId >= 31_000_000 ? -1 : 0.5,
  whClass: solarSystemId >= 31_000_000 ? 3 : 7,
  classLabel: solarSystemId >= 31_000_000 ? 'C3' : 'HS',
  via,
  connectionId: via === 'wormhole' && !extra.edge ? 'c1' : null,
  regionName: 'Somewhere',
  ...extra,
});

describe('travelLegs', () => {
  it('turns route steps into legs of the kind the panel tags', () => {
    const legs = travelLegs([
      step(IGNOITTON, 'start'),
      step(JITA, 'gate'),
      step(THERA, 'wormhole', { edge: 'eve-scout', whClass: 12, classLabel: 'Thera' }),
      step(AHBAZON, 'wormhole', { edge: 'eve-scout' }),
      step(J_SYSTEM, 'wormhole'),
      step(DELVE, 'wormhole'),
      step(30004760, 'bridge', { edge: 'ansiblex' }),
      step(TURNUR, 'wormhole', { edge: 'eve-scout' }),
      step(AMI, 'gate'),
    ]);
    expect(legs.map((l) => l.kind)).toEqual([
      'gate',
      'thera',
      'thera',
      'wormhole',
      'wormhole',
      'ansiblex',
      'turnur',
      'gate',
    ]);
    expect(legs[1]).toMatchObject({
      from: { id: JITA },
      to: { id: THERA, classLabel: 'Thera', whClass: 12, region: 'Somewhere' },
      stop: false,
    });
    // A map connection of the bridge kind is a jump bridge too.
    expect(travelLegs([step(DELVE, 'start'), step(30004760, 'bridge')])[0]!.kind).toBe('ansiblex');
  });

  it('marks the last leg when the route ends at a stop; a route of one system has none', () => {
    const legs = travelLegs([step(IGNOITTON, 'start'), step(JITA, 'gate'), step(AMI, 'gate')], true);
    expect(legs.map((l) => l.stop)).toEqual([false, true]);
    expect(travelLegs([step(IGNOITTON, 'start')], true)).toEqual([]);
  });
});

describe('travelWaypointParts', () => {
  const targets = (legs: Parameters<typeof travelWaypointParts>[0]) =>
    travelWaypointParts(legs).map((p) => p.targets);

  it('cuts the trip where each hole or bridge is taken; never wormhole space', () => {
    const legs = travelLegs([
      step(IGNOITTON, 'start'),
      step(JITA, 'gate'),
      step(THERA, 'wormhole', { edge: 'eve-scout' }),
      step(AHBAZON, 'wormhole', { edge: 'eve-scout' }),
      step(J_SYSTEM, 'wormhole'),
      step(DELVE, 'wormhole'),
      step(30004760, 'bridge', { edge: 'ansiblex' }),
      step(AMI, 'gate'),
    ]);
    // To Jita (into Thera); out in Ahbazon the next hole is right there, nothing to fly; out of
    // J-space in Delve the bridge is right there too; from its far end, by gate to Ami.
    const parts = travelWaypointParts(legs);
    expect(parts.map((p) => p.targets)).toEqual([[JITA], [AMI]]);
    expect(parts.map((p) => p.then?.kind ?? null)).toEqual(['thera', null]);
  });

  it('keeps the stops of a part in order, skips where it sets off and the same system twice', () => {
    const plan = travelPlan([
      // Ignoitton > (hole right at the start) > J-space > Ahbazon, a stop where the next hole is taken.
      {
        same: false,
        error: null,
        data: route([step(IGNOITTON, 'start'), step(J_SYSTEM, 'wormhole'), step(AHBAZON, 'wormhole')]),
      },
      {
        same: false,
        error: null,
        data: route([
          step(AHBAZON, 'start'),
          step(THERA, 'wormhole', { edge: 'eve-scout' }),
          step(JITA, 'wormhole', { edge: 'eve-scout' }),
        ]),
      },
      // Back where the trip started, by gates, through a stop.
      { same: false, error: null, data: route([step(JITA, 'start'), step(AMI, 'gate')]) },
      { same: false, error: null, data: route([step(AMI, 'start'), step(IGNOITTON, 'gate')]) },
    ]);
    expect(targets(plan.legs!)).toEqual([[AMI, IGNOITTON]]);
  });

  it('is only the destination for a trip on stargates', () => {
    const legs = travelLegs([step(IGNOITTON, 'start'), step(JITA, 'gate'), step(AMI, 'gate')]);
    expect(travelWaypointParts(legs)).toEqual([{ targets: [AMI], then: null }]);
    expect(travelWaypointParts([])).toEqual([]);
  });

  it('stops the autopilot at the Thera hole of C-J6MT > Amarr instead of flying on to Amarr', () => {
    // 2026-11-19: C-J6MT > 15 gates > 8-KZXQ > Thera > Domain > Amarr. Sent as one list
    // ([8-KZXQ, Amarr]) the autopilot did not stop in 8-KZXQ; with the hole gone it flew on to
    // Amarr over gates, back through UD-AOK and N-RAEL the way the pilot came.
    const C_J6MT = 30000772;
    const D_I9HJ = 30002481;
    const KZXQ = 30002484;
    const ARBAZ = 30003487;
    const AMARR = 30002187;
    const hole: RouteHoleDto = {
      id: '78659',
      hubSystemId: THERA,
      solarSystemId: KZXQ,
      hubSignature: 'QHM-106',
      signature: 'KSE-870',
      whType: 'E587',
      maxShipSize: 'xlarge',
      remainingHours: 14,
      expiresAt: Date.parse('2026-11-20T10:10:37Z'),
      updatedAt: Date.parse('2026-11-19T17:39:27Z'),
    };
    const legs = travelLegs([
      step(C_J6MT, 'start', { name: 'C-J6MT' }),
      step(D_I9HJ, 'gate', { name: 'D-I9HJ' }),
      step(KZXQ, 'gate', { name: '8-KZXQ' }),
      step(THERA, 'wormhole', { name: 'Thera', edge: 'eve-scout', hole }),
      step(ARBAZ, 'wormhole', { name: 'Arbaz', edge: 'eve-scout', hole: { ...hole, id: '78655' } }),
      step(30003489, 'gate', { name: 'Chaven' }),
      step(30003491, 'gate', { name: 'Ashab' }),
      step(AMARR, 'gate', { name: 'Amarr' }),
    ]);
    const parts = travelWaypointParts(legs);
    expect(parts.map((p) => p.targets)).toEqual([[KZXQ], [AMARR]]);
    expect(parts[0]!.then).toMatchObject({
      kind: 'thera',
      from: { id: KZXQ },
      hole: { signature: 'KSE-870' },
    });
    expect(handoverText(parts[0]!.then!, Date.parse('2026-11-19T20:39:27Z'))).toBe(
      'Take the Thera hole in 8-KZXQ: signature KSE-870 (E587, xlarge), reported 3 h ago, about 14 h left. ' +
        'If it is not there, it has closed: plan again from 8-KZXQ.',
    );
    // The way out of Thera is named by Thera's own signature.
    expect(handoverText(legs[3]!, Date.parse('2026-11-19T17:49:27Z'))).toContain(
      'Take the hole to Arbaz in Thera: signature QHM-106 (E587, xlarge), reported 10 min ago',
    );
  });
});

describe('missingHoles', () => {
  it('names the holes of the trip EVE-Scout no longer lists', () => {
    const hole = (id: string): RouteHoleDto => ({
      id,
      hubSystemId: THERA,
      solarSystemId: JITA,
      hubSignature: null,
      signature: null,
      whType: null,
      maxShipSize: null,
      remainingHours: null,
      expiresAt: null,
      updatedAt: null,
    });
    const legs = travelLegs([
      step(IGNOITTON, 'start'),
      step(JITA, 'gate'),
      step(THERA, 'wormhole', { edge: 'eve-scout', hole: hole('a') }),
      step(AHBAZON, 'wormhole', { edge: 'eve-scout', hole: hole('b') }),
    ]);
    const feed = (ids: string[]): TheraDto => ({
      fetchedAt: 0,
      connections: ids.map((id) => ({
        id,
        hub: 'thera',
        hubSystemId: THERA,
        solarSystemId: JITA,
        name: 'Jita',
        security: 0.9,
        regionName: 'The Forge',
        whType: null,
        maxShipSize: null,
        hubSignature: null,
        signature: null,
        remainingHours: null,
        expiresAt: null,
      })),
    });
    expect(missingHoles(legs, feed(['a', 'b']))).toEqual([]);
    expect(missingHoles(legs, feed(['a'])).map((l) => l.to.id)).toEqual([AHBAZON]);
  });
});

function route(steps: RouteStepDto[], jumps: number | null = steps.length - 1): RouteDto {
  return {
    from: steps[0]!.solarSystemId,
    to: steps.at(-1)!.solarSystemId,
    mode: 'shortest',
    jumps,
    steps,
    securityStatus: null,
  };
}

describe('travelPlan', () => {
  it('has every leg once each segment has its way, and says which segment lacks one', () => {
    const ok = { same: false, error: null, data: route([step(IGNOITTON, 'start'), step(JITA, 'gate')]) };
    const none = { same: false, error: null, data: route([step(JITA, 'start')], null) };
    const pending = { same: false, error: null, data: undefined };
    const failed = { same: false, error: new Error('down'), data: undefined };
    const same = { same: true, error: null, data: undefined };
    expect(travelPlan([ok, same]).legs).toHaveLength(1);
    expect(travelPlan([ok, same]).legs![0]!.stop).toBe(true);
    const partial = travelPlan([ok, none, pending, failed]);
    expect(partial.legs).toBeNull();
    expect(partial.segments.map((s) => s.status)).toEqual(['ok', 'none', 'pending', 'error']);
    expect(travelPlan([]).legs).toBeNull();
  });
});

describe('travelTotals', () => {
  it('counts the jumps and those that are not stargates', () => {
    const legs = travelLegs([
      step(IGNOITTON, 'start'),
      step(JITA, 'gate'),
      step(THERA, 'wormhole', { edge: 'eve-scout' }),
      step(AHBAZON, 'wormhole', { edge: 'eve-scout' }),
      step(J_SYSTEM, 'wormhole'),
      step(AMI, 'wormhole'),
    ]);
    expect(travelTotals(legs)).toEqual({
      jumps: 5,
      gates: 1,
      wormholes: 2,
      thera: 2,
      turnur: 0,
      ansiblex: 0,
    });
  });
});

describe('mapLegs', () => {
  const model = buildStarModel(UNIVERSE);
  const idx = (id: number) => model.indexById.get(id)!;

  it('draws known space only, a run through wormhole space as one leg between its known ends', () => {
    const legs = travelLegs([
      step(IGNOITTON, 'start'),
      step(JITA, 'gate'),
      step(THERA, 'wormhole', { edge: 'eve-scout' }),
      step(AHBAZON, 'wormhole', { edge: 'eve-scout' }),
      step(AMI, 'wormhole'),
    ]);
    const drawn = mapLegs(legs, model);
    expect(drawn.legs).toEqual([
      { from: idx(IGNOITTON), to: idx(JITA), kind: 'gate' },
      { from: idx(JITA), to: idx(AHBAZON), kind: 'thera' },
      { from: idx(AHBAZON), to: idx(AMI), kind: 'wormhole' },
    ]);
    expect(drawn.index).toEqual([0, 1, 1, 2]);
  });

  it('skips what it cannot place without failing', () => {
    // Delve is not in the test universe: nothing to draw from it or to it.
    const legs = travelLegs([step(DELVE, 'start'), step(J_SYSTEM, 'wormhole'), step(AMI, 'wormhole')]);
    expect(mapLegs(legs, model)).toEqual({ legs: [], index: [null, null] });
  });
});
