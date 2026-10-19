import { describe, expect, it } from 'vitest';
import { bridgeFuel, fatigueAfterJump, jumpFuel, jumpRange, waitForFatigueCap } from './formulas.js';
import { hullOfGroup } from './hulls.js';
import { canJumpFrom, isCynoTarget, planJumpRoute, type PlanOptions } from './planner.js';
import { FLAG_POCHVEN, FLAG_STATION, FLAG_ZARZAKH, JumpSpace, type JumpShipData } from './space.js';

// Ships as the SDE (build 3586130) has them.
const ARK: JumpShipData = {
  typeId: 28850,
  name: 'Ark',
  group: 902,
  rangeLy: 5,
  fuelPerLy: 8800,
  isotope: 'helium',
  fatigueMultiplier: 0.1,
  mass: 900_000_000,
  portalMassFactor: null,
};
const ARCHON: JumpShipData = {
  typeId: 23757,
  name: 'Archon',
  group: 547,
  rangeLy: 3.5,
  fuelPerLy: 3000,
  isotope: 'helium',
  fatigueMultiplier: 1,
  mass: 1_260_000_000,
  portalMassFactor: null,
};
const AVATAR: JumpShipData = {
  typeId: 11567,
  name: 'Avatar',
  group: 30,
  rangeLy: 3,
  fuelPerLy: 3000,
  isotope: 'helium',
  fatigueMultiplier: 1,
  mass: 2_400_000_000,
  portalMassFactor: 1e-9,
};
const REDEEMER: JumpShipData = {
  typeId: 22428,
  name: 'Redeemer',
  group: 898,
  rangeLy: 4,
  fuelPerLy: 700,
  isotope: 'helium',
  fatigueMultiplier: 0.25,
  mass: 112_700_000,
  portalMassFactor: 1.35e-7,
};

describe('formulas', () => {
  it('adds 20 % range per level of Jump Drive Calibration', () => {
    // "at the maximum of level five the range is doubled" (wiki.eveuniversity.org/Jump_drives)
    expect(jumpRange(5, 5)).toBe(10); // jump freighter
    expect(jumpRange(3, 5)).toBe(6); // titan, supercarrier
    expect(jumpRange(3.5, 5)).toBe(7); // carrier, dreadnought, force auxiliary
    expect(jumpRange(4, 5)).toBe(8); // black ops, lancer
    expect(jumpRange(3.75, 5)).toBe(7.5); // command carrier
    expect(jumpRange(5, 4)).toBe(9);
    expect(jumpRange(5, 0)).toBe(5);
  });

  it('takes 10 % fuel per level of Jump Fuel Conservation and, for jump freighters, Jump Freighters', () => {
    // "you use half the fuel at the maximum level of five"
    expect(jumpFuel(3000, 7, { jfc: 5, jf: 5 }, false)).toBe(10_500);
    expect(jumpFuel(3000, 7, { jfc: 0, jf: 5 }, false)).toBe(21_000);
    expect(jumpFuel(8800, 10, { jfc: 5, jf: 5 }, true)).toBe(22_000);
    expect(jumpFuel(8800, 10, { jfc: 4, jf: 4 }, true)).toBe(31_680);
    // Rounded up to whole isotopes, without float noise.
    expect(jumpFuel(700, 1.234, { jfc: 5, jf: 0 }, false)).toBe(432);
    expect(jumpFuel(8800, 1, { jfc: 4, jf: 0 }, false)).toBe(5280);
  });

  it('costs bridge fuel by mass, portal factor, base fuel, distance and Jump Fuel Conservation', () => {
    // A 100 000 t fleet bridged 5 ly by a titan with JFC V: 1e8 kg * 1e-9 * 3000 * 5 * 0.5.
    expect(bridgeFuel(1e8, 1e-9, 3000, 5, 5)).toBe(750);
    expect(bridgeFuel(1.2e6, 1.35e-7, 700, 8, 0)).toBe(908);
  });

  it('follows the worked carrier example of five 5 ly jumps', () => {
    // wiki.eveuniversity.org/Jump_fatigue: 6 min / 60 min, then 6 min / 5 h, then 30 min / 5 h.
    const first = fatigueAfterJump(0, 5);
    expect(first).toEqual({ activation: 6, fatigue: 60 });
    const second = fatigueAfterJump(first.fatigue - first.activation, 5);
    expect(second).toEqual({ activation: 6, fatigue: 300 });
    const third = fatigueAfterJump(second.fatigue - second.activation, 5);
    expect(third.activation).toBeCloseTo(29.4, 5);
    expect(third.fatigue).toBe(300);
    expect(fatigueAfterJump(300, 6)).toEqual({ activation: 30, fatigue: 300 });
  });

  it('gives jump freighters a tenth of the distance', () => {
    // 10 ly at 90 % reduction counts as 1 ly: at least 10 x (1 + 1) minutes.
    expect(fatigueAfterJump(0, 10 * 0.1)).toEqual({ activation: 2, fatigue: 20 });
    expect(fatigueAfterJump(18, 1)).toEqual({ activation: 2, fatigue: 36 });
  });

  it('knows how long to wait to stay under a fatigue cap', () => {
    expect(waitForFatigueCap(0, 5, 60)).toBe(0);
    expect(waitForFatigueCap(54, 5, 60)).toBe(44);
    expect(waitForFatigueCap(0, 5, 59)).toBeNull();
  });
});

describe('hulls', () => {
  it('maps SDE ship groups to hulls', () => {
    expect(hullOfGroup(902)).toBe('jump_freighter');
    expect(hullOfGroup(30)).toBe('titan');
    expect(hullOfGroup(4594)).toBe('lancer');
    expect(hullOfGroup(5120)).toBe('command_carrier');
    expect(hullOfGroup(513)).toBeNull(); // freighters have no jump drive
  });
});

/** A hand-built space: systems on the x axis at the given light years. */
function line(
  systems: Array<{ x: number; security?: number; flags?: number; region?: number; y?: number }>,
  gates: Array<[number, number]> = [],
): JumpSpace {
  return new JumpSpace({
    source: 'test',
    regions: [
      { id: 10000001, name: 'One' },
      { id: 10000002, name: 'Two' },
    ],
    systems: {
      id: systems.map((_, i) => 30000001 + i),
      name: systems.map((_, i) => `S${i}`),
      region: systems.map((s) => s.region ?? 0),
      security: systems.map((s) => s.security ?? -0.5),
      x: systems.map((s) => s.x),
      y: systems.map((s) => s.y ?? 0),
      z: systems.map(() => 0),
      flags: systems.map((s) => s.flags ?? 0),
    },
    gates: gates.flat(),
    ships: [ARK, ARCHON, AVATAR, REDEEMER],
  });
}

function plan(
  space: JumpSpace,
  ship: JumpShipData,
  origin: number,
  destination: number,
  extra: Partial<PlanOptions> = {},
) {
  return planJumpRoute(space, {
    ship: space.ship(ship.typeId)!,
    origin,
    destination,
    skills: { jdc: 5, jfc: 5, jf: 5 },
    ...extra,
  });
}

const path = (outcome: ReturnType<typeof plan>) =>
  outcome.ok ? [outcome.route.legs[0]!.from, ...outcome.route.legs.map((l) => l.to)] : null;

describe('restrictions', () => {
  const space = line([
    { x: 0 },
    { x: 1, security: 0.5 },
    { x: 2, security: 0.449 },
    { x: 3, flags: FLAG_POCHVEN },
    { x: 4, flags: FLAG_ZARZAKH, security: -1 },
  ]);

  it('lights cynos only outside high-sec, Pochven and Zarzakh', () => {
    expect(isCynoTarget(space, 0)).toBe(true);
    expect(isCynoTarget(space, 1)).toBe(false); // 0.5
    expect(isCynoTarget(space, 2)).toBe(true); // 0.449 shows as 0.4
    expect(isCynoTarget(space, 3)).toBe(false);
    expect(isCynoTarget(space, 4)).toBe(false);
  });

  it('lets jump drives start anywhere but Zarzakh', () => {
    expect(canJumpFrom(space, 3)).toBe(true);
    expect(canJumpFrom(space, 4)).toBe(false);
  });

  it('keeps capitals out of high-sec and Zarzakh, and lets jump freighters leave high-sec', () => {
    expect(plan(space, ARCHON, 1, 0)).toMatchObject({ ok: false, problem: 'origin_not_allowed' });
    expect(plan(space, ARCHON, 0, 1)).toMatchObject({ ok: false, problem: 'destination_not_allowed' });
    expect(plan(space, ARCHON, 0, 4)).toMatchObject({ ok: false, problem: 'destination_not_allowed' });
    expect(path(plan(space, ARK, 1, 0))).toEqual([1, 0]);
    // Out of Pochven, but never into it.
    expect(path(plan(space, ARCHON, 3, 0))).toEqual([3, 0]);
    expect(plan(space, ARCHON, 0, 3, { gates: 'never' })).toMatchObject({ ok: false, problem: 'no_route' });
  });

  it('refuses a trip to the same system', () => {
    expect(plan(space, ARK, 0, 0)).toMatchObject({ ok: false, problem: 'same_system' });
  });
});

describe('planJumpRoute', () => {
  // Every 4 ly a system: an Archon (7 ly) makes one hop at a time, an Ark (10 ly) two.
  const chain = line([{ x: 0 }, { x: 4 }, { x: 8 }, { x: 12 }, { x: 16 }, { x: 20 }]);

  it('takes the fewest jumps within range', () => {
    expect(path(plan(chain, ARCHON, 0, 5))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(path(plan(chain, ARK, 0, 4))).toEqual([0, 2, 4]);
    expect(plan(chain, ARCHON, 0, 5, { skills: { jdc: 0, jfc: 5, jf: 5 } })).toMatchObject({
      ok: false,
      problem: 'no_route',
    });
  });

  it('adds up fuel and fatigue per leg', () => {
    const outcome = plan(chain, ARCHON, 0, 2);
    if (!outcome.ok) throw new Error(outcome.message);
    const [first, second] = outcome.route.legs;
    expect(first).toMatchObject({
      kind: 'jump',
      ly: 4,
      fuel: 6000,
      waitMinutes: 0,
      activationMinutes: 5,
      fatigueMinutes: 50,
    });
    // Waits out the 5 minute timer: 45 minutes of fatigue left, times (1 + 4).
    expect(second).toMatchObject({ waitMinutes: 5, activationMinutes: 5, fatigueMinutes: 225 });
    expect(outcome.route).toMatchObject({
      jumps: 2,
      fuel: 12_000,
      ly: 8,
      waitMinutes: 5,
      fatigueMinutes: 225,
    });
  });

  it('waits between jumps to keep fatigue under a cap', () => {
    const outcome = plan(chain, ARCHON, 0, 2, { maxFatigue: 60 });
    if (!outcome.ok) throw new Error(outcome.message);
    const second = outcome.route.legs[1]!;
    // 50 minutes after the first jump; at most 60 / (1 + 4) = 12 may be left: wait 38.
    expect(second.waitMinutes).toBeCloseTo(38, 6);
    expect(second.fatigueMinutes).toBeCloseTo(60, 6);
    const tooTight = plan(chain, ARCHON, 0, 1, { maxFatigue: 40 });
    expect(tooTight.ok && tooTight.route.notes).toHaveLength(1);
  });

  it('prefers systems with a station when asked, at the cost of fuel', () => {
    const space = line([{ x: 0 }, { x: 5 }, { x: 4, y: 3, flags: FLAG_STATION }, { x: 9 }]);
    expect(path(plan(space, ARCHON, 0, 3))).toEqual([0, 1, 3]);
    expect(path(plan(space, ARCHON, 0, 3, { preferStations: true }))).toEqual([0, 2, 3]);
  });

  it('stays out of avoided systems and regions', () => {
    const space = line([{ x: 0 }, { x: 5 }, { x: 4, y: 3, region: 1 }, { x: 9 }]);
    expect(path(plan(space, ARCHON, 0, 3, { avoidSystems: new Set([1]) }))).toEqual([0, 2, 3]);
    expect(
      path(plan(space, ARCHON, 0, 3, { avoidRegions: new Set([10000002]), avoidSystems: new Set([1]) })),
    ).toBeNull();
  });

  it('finishes over stargates into high-sec for jump freighters', () => {
    const space = line(
      [{ x: 0 }, { x: 9 }, { x: 10, security: 0.9 }, { x: 11, security: 0.8 }],
      [
        [1, 2],
        [2, 3],
      ],
    );
    const outcome = plan(space, ARK, 0, 3);
    expect(outcome.ok && outcome.route.legs.map((l) => l.kind)).toEqual(['jump', 'gate', 'gate']);
    expect(plan(space, ARK, 0, 3, { gates: 'never' })).toMatchObject({ ok: false, problem: 'no_route' });
    expect(plan(space, ARK, 0, 3, { outlaw: true })).toMatchObject({
      ok: false,
      problem: 'destination_not_allowed',
    });
  });

  it('never gates where a cyno can be lit', () => {
    // S1 to S2 is a gate or a jump: the same number of legs, one jump fewer over the gate.
    const space = line([{ x: 0 }, { x: 9 }, { x: 18 }], [[1, 2]]);
    const outcome = plan(space, ARK, 0, 2);
    expect(outcome.ok && outcome.route.legs.map((l) => l.kind)).toEqual(['jump', 'jump']);
  });

  it('never routes outlaws through high-sec on the way', () => {
    // Black ops without Jump Drive Calibration (4 ly) reach S1, then gate around S2 (high-sec).
    const space = line(
      [{ x: 0 }, { x: 4 }, { x: 8, security: 0.9 }, { x: 12 }, { x: 8, y: 6 }],
      [
        [1, 2],
        [2, 3],
        [1, 4],
        [4, 3],
      ],
    );
    const slow = { skills: { jdc: 0, jfc: 5, jf: 5 } };
    expect(path(plan(space, REDEEMER, 0, 3, { ...slow, outlaw: true }))).toEqual([0, 1, 4, 3]);
    const anyway = plan(space, REDEEMER, 0, 3, slow);
    expect(anyway.ok && anyway.route).toMatchObject({ jumps: 1, gates: 2 });
  });

  it('uses Ansiblex bridges where the hull may', () => {
    const space = line([{ x: 0 }, { x: 4 }, { x: 8.5 }, { x: 12.5 }]);
    const ansiblex = [[1, 2] as const];
    const slow = { skills: { jdc: 0, jfc: 5, jf: 5 } };
    expect(plan(space, ARK, 0, 3, slow)).toMatchObject({ ok: true, route: { jumps: 3 } });
    const jf = plan(space, ARK, 0, 3, { ...slow, ansiblex });
    expect(jf.ok && jf.route.legs.map((l) => l.kind)).toEqual(['jump', 'ansiblex', 'jump']);
    const carrier = plan(space, ARCHON, 0, 3, { ansiblex });
    expect(carrier.ok && carrier.route.ansiblex).toBe(0);
    expect(carrier.ignoredAnsiblex[0]?.why).toMatch(/cannot use Ansiblex/);
    const far = plan(space, ARK, 0, 3, { ansiblex: [[0, 2]] });
    expect(far.ignoredAnsiblex[0]?.why).toMatch(/more than 5 ly/);
  });

  it('prices titan and black ops bridges per leg', () => {
    const outcome = plan(chain, AVATAR, 0, 1, { bridgeMassKg: 1e8 });
    expect(outcome.ok && outcome.route.legs[0]!.bridgeFuel).toBe(600); // 1e8 * 1e-9 * 3000 * 4 * 0.5
    const none = plan(chain, ARCHON, 0, 1, { bridgeMassKg: 1e8 });
    expect(none.ok && none.route.bridgeFuel).toBeNull();
  });
});
