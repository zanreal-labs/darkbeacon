import { describe, expect, it } from 'vitest';
import type { JumpPlanDto } from '@darkbeacon/shared';
import { alternativeAt, dotRadius, toScreen, toWorld, type Overlay } from './draw';
import { ARK, UNIVERSE } from './fixtures.test-support';
import { formatMinutes, routeText } from './format';
import {
  BUCKET_POCHVEN,
  buildStarModel,
  distanceLy,
  noCynoReason,
  searchSystems,
  securityBucket,
  systemAt,
} from './model';

const model = buildStarModel(UNIVERSE);

describe('star model', () => {
  it('projects top-down with north up, like the in-game map', () => {
    // Jita (z 12.42) is north of Ami (z -3): a smaller screen y.
    expect(model.py[0]).toBeCloseTo(-12.42);
    expect(model.py[0]!).toBeLessThan(model.py[3]!);
    expect(model.px[0]).toBeCloseTo(-13.64);
    expect(model.bounds.minX).toBe(-21);
    expect(model.bounds.maxX).toBeCloseTo(-13.64, 5);
  });

  it('colours by displayed security and marks special space', () => {
    expect(securityBucket(0.9459)).toBe(9);
    expect(securityBucket(0.4388)).toBe(4);
    expect(securityBucket(0.04)).toBe(1); // 0.0 < s < 0.05 shows as 0.1
    expect(securityBucket(-0.7)).toBe(0);
    const pochven = buildStarModel({
      ...UNIVERSE,
      systems: { ...UNIVERSE.systems, flags: [2, 0, 0, 0] },
    });
    expect(pochven.bucket[0]).toBe(BUCKET_POCHVEN);
  });

  it('measures light years in 3D and finds systems under the pointer', () => {
    expect(distanceLy(model, 0, 1)).toBeCloseTo(Math.hypot(0.56, 0.42, 3.42), 5);
    expect(systemAt(model, -14.1, -9.1, 0.5)).toBe(1);
    expect(systemAt(model, 0, 0, 0.5)).toBe(-1);
  });

  it('searches names by prefix first', () => {
    expect(searchSystems(model, 'a').map((i) => model.names[i])).toEqual(['Ahbazon', 'Ami', 'Jita']);
    expect(searchSystems(model, '')).toEqual([]);
  });

  it('knows where no cyno can be lit', () => {
    expect(noCynoReason(model, 0)).toMatch(/High-sec/);
    expect(noCynoReason(model, 1)).toBeNull();
  });

  it('turns screen and world coordinates into each other', () => {
    const view = { scale: 10, cx: 5, cy: -3, width: 800, height: 600 };
    const [sx, sy] = toScreen(view, 7, -1);
    expect([sx, sy]).toEqual([420, 320]);
    expect(toWorld(view, sx, sy)).toEqual([7, -1]);
    expect(dotRadius(1)).toBeGreaterThan(1);
    expect(dotRadius(1000)).toBeLessThanOrEqual(4.5);
  });

  it('finds the other route drawn under the pointer, to pick it', () => {
    const view = { scale: 40, cx: model.px[1]!, cy: model.py[1]!, width: 800, height: 600 };
    const overlay = { alternatives: [[{ from: 1, to: 3, kind: 'gate' as const }]] } as unknown as Overlay;
    const [ax, ay] = toScreen(view, model.px[1]!, model.py[1]!);
    const [bx, by] = toScreen(view, model.px[3]!, model.py[3]!);
    expect(alternativeAt(model, view, overlay, { x: (ax + bx) / 2, y: (ay + by) / 2 + 3 })).toBe(0);
    expect(alternativeAt(model, view, overlay, { x: ax + 200, y: ay - 200 })).toBeNull();
  });
});

describe('formatting', () => {
  it('writes minutes the way pilots say them', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(0.5)).toBe('30 s');
    expect(formatMinutes(36.2)).toBe('36 min');
    expect(formatMinutes(65)).toBe('1 h 05 min');
    expect(formatMinutes(300)).toBe('5 h');
  });

  it('copies a route as plain lines for fleet chat', () => {
    const ref = (i: number) => ({
      id: UNIVERSE.systems.id[i]!,
      name: UNIVERSE.systems.name[i]!,
      security: UNIVERSE.systems.security[i]!,
      region: i < 2 ? 'The Forge' : 'Domain',
      station: false,
    });
    const leg = { bridgeFuel: null, waitMinutes: 0, activationMinutes: 2, fatigueMinutes: 20, stop: false };
    const plan: JumpPlanDto = {
      ship: ARK,
      rangeLy: 10,
      route: {
        legs: [
          { ...leg, kind: 'jump', from: ref(1), to: ref(2), ly: 9.95, fuel: 31_524 },
          { ...leg, kind: 'jump', from: ref(2), to: ref(3), ly: 8.17, fuel: 25_884 },
          { ...leg, kind: 'gate', from: ref(3), to: ref(0), ly: 20, fuel: 0 },
        ],
        jumps: 2,
        gates: 1,
        ansiblex: 0,
        ly: 18.12,
        fuel: 57_408,
        bridgeFuel: null,
        waitMinutes: 2,
        fatigueMinutes: 36.4,
        activationMinutes: 2,
        notes: [],
        best: [],
      },
      alternatives: [],
      problem: null,
      ignoredAnsiblex: [],
    };
    expect(routeText(plan)).toBe(
      [
        'Ark: Ignoitton > Jita (2 jumps, 1 gate, 18.12 ly, 57,408 helium isotopes)',
        '1. Jump 9.95 ly to Ahbazon (0.4, Domain), industrial cyno, 31,524 fuel',
        '2. Jump 8.17 ly to Ami (0.4, Domain), industrial cyno, 25,884 fuel',
        '3. Gate to Jita (0.9, The Forge)',
        'Fatigue at the end: 36 min',
      ].join('\n'),
    );
  });
});
