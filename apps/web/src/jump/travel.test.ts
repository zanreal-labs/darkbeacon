import { describe, expect, it } from 'vitest';
import type { RouteDto, RouteStepDto } from '@darkbeacon/shared';
import { buildStarModel } from './model';
import { UNIVERSE } from './fixtures.test-support';
import { mapLegs, THERA, travelLegs, travelPlan, travelTotals, travelWaypoints, TURNUR } from './travel';

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

describe('travelWaypoints', () => {
  it('sends where each hole or bridge is taken, then the destination, never wormhole space', () => {
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
    // Jita (into Thera), Thera itself left out, Ahbazon (into the chain), the J-space system left
    // out, Delve's bridge end, Ami.
    expect(travelWaypoints(legs)).toEqual([JITA, AHBAZON, DELVE, AMI]);
  });

  it('keeps every stop in order, skips the start and the same system twice in a row', () => {
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
      // Back where the trip started, by gates.
      { same: false, error: null, data: route([step(JITA, 'start'), step(IGNOITTON, 'gate')]) },
    ]);
    expect(travelWaypoints(plan.legs!)).toEqual([AHBAZON, JITA, IGNOITTON]);
  });

  it('is only the destination for a trip on stargates', () => {
    const legs = travelLegs([step(IGNOITTON, 'start'), step(JITA, 'gate'), step(AMI, 'gate')]);
    expect(travelWaypoints(legs)).toEqual([AMI]);
    expect(travelWaypoints([])).toEqual([]);
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
