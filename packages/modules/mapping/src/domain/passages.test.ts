import { describe, expect, it } from 'vitest';
import { jumpMass, type MassModifiersDto, type RollStepDto, type ShipMassFacts } from '@darkbeacon/shared';
import { fitMass, parseFit, weighFit, type FitItem } from './fit.js';
import { countedPassages, fitsThrough, possibleStatuses, remainingMassRange } from './mass.js';
import { planRoll, type RollShip } from './rolling.js';

const Mt = 1_000_000_000; // a million tonnes, in kg

/** SDE build 3586130: massAddition per prop size, Higgs Anchor +100 %, mass entangler -80 %. */
const MODIFIERS: MassModifiersDto = {
  prop: { small: 500_000, medium: 5_000_000, large: 50_000_000, capital: 500_000_000 },
  higgsPercent: 100,
  entanglerPercent: -80,
};
const MEGATHRON: ShipMassFacts = { mass: 98_400_000, propMass: 50_000_000, higgs: true, entangler: false };
const ORCA: ShipMassFacts = { mass: 150_000_000, propMass: 50_000_000, higgs: true, entangler: false };
const ONYX: ShipMassFacts = { mass: 15_400_000, propMass: 5_000_000, higgs: true, entangler: true };
const CHARON: ShipMassFacts = { mass: 960_000_000, propMass: null, higgs: false, entangler: false };

function ship(
  index: number,
  name: string,
  facts: ShipMassFacts,
  fit: { higgs?: boolean; entangler?: boolean } = {},
): RollShip {
  return {
    index,
    shipTypeId: 1000 + index,
    name,
    // The entangler is switched on going out and off coming back hot.
    cold: jumpMass(facts, { massMode: 'cold', ...fit }, MODIFIERS)!,
    hot: jumpMass(facts, { massMode: 'hot', higgs: fit.higgs }, MODIFIERS)!,
  };
}

/** Nobody is ever planned out through a jump that may close the hole, unless the plan says so. */
function expectSane(steps: RollStepDto[], maxJumpMass: number) {
  for (const step of steps) expect(step.mass).toBeLessThanOrEqual(maxJumpMass);
  for (let i = 0; i < steps.length; i += 2) {
    expect(steps[i]!.direction).toBe('out');
    expect(steps[i + 1]!.direction).toBe('back');
    expect(steps[i + 1]!.ship).toBe(steps[i]!.ship);
  }
  // A jump that surely closes the hole never goes out.
  expect(steps.filter((s) => s.direction === 'out' && s.collapse === 'will')).toEqual([]);
  // The plan stops at the first jump that surely closes it.
  const will = steps.findIndex((s) => s.collapse === 'will');
  if (will >= 0) expect(will).toBe(steps.length - 1);
}

describe('jump mass', () => {
  it('counts the hull cold and adds the prop module hot', () => {
    expect(jumpMass(MEGATHRON, { massMode: 'cold' }, MODIFIERS)).toBe(98_400_000);
    expect(jumpMass(MEGATHRON, { massMode: 'hot' }, MODIFIERS)).toBe(148_400_000);
    // A freighter has no mid slot: hot is cold.
    expect(jumpMass(CHARON, { massMode: 'hot' }, MODIFIERS)).toBe(960_000_000);
  });

  it('doubles everything with a Higgs Anchor and cuts it to a fifth with a mass entangler', () => {
    expect(jumpMass(MEGATHRON, { massMode: 'hot', higgs: true }, MODIFIERS)).toBe(296_800_000);
    expect(jumpMass(ONYX, { massMode: 'cold', entangler: true }, MODIFIERS)).toBe(3_080_000);
    expect(jumpMass(ONYX, { massMode: 'hot', higgs: true }, MODIFIERS)).toBe(40_800_000);
    // Modules that do not fit change nothing.
    expect(jumpMass(MEGATHRON, { massMode: 'cold', entangler: true }, MODIFIERS)).toBe(98_400_000);
  });

  it('takes a custom mass as given and knows nothing of unknown ships', () => {
    expect(jumpMass(null, { massMode: 'custom', mass: 123 }, MODIFIERS)).toBe(123);
    expect(jumpMass(null, { massMode: 'hot' }, MODIFIERS)).toBeNull();
  });

  it('checks the max jump mass', () => {
    expect(fitsThrough(148_400_000, 375_000_000)).toBe(true);
    expect(fitsThrough(296_800_000, 62_000_000)).toBe(false);
    expect(fitsThrough(1, null)).toBe(true);
  });
});

describe('remaining mass range', () => {
  it('spans the status band of a total that may be 10 % off', () => {
    expect(
      remainingMassRange({
        total: 2 * Mt,
        status: 'fresh',
        passed: 0,
        unknownPassages: 0,
        maxJumpMass: 375_000_000,
        regenerates: false,
      }),
    ).toEqual({ min: 0.9 * Mt, max: 2.2 * Mt, overdrawn: false });
    const reduced = remainingMassRange({
      total: 2 * Mt,
      status: 'reduced',
      passed: 0.3 * Mt,
      unknownPassages: 0,
      maxJumpMass: 375_000_000,
      regenerates: false,
    });
    expect(reduced.min).toBe(0);
    expect(reduced.max).toBeCloseTo(0.8 * Mt);
  });

  it('lets unknown ships lower the minimum by up to the max jump mass each', () => {
    const range = remainingMassRange({
      total: 3 * Mt,
      status: 'fresh',
      passed: 0,
      unknownPassages: 2,
      maxJumpMass: 375_000_000,
      regenerates: false,
    });
    expect(range.min).toBeCloseTo(1.35 * Mt - 0.75 * Mt);
    expect(range.max).toBeCloseTo(3.3 * Mt);
  });

  it('says when more passed than the status allowed', () => {
    expect(
      remainingMassRange({
        total: 1 * Mt,
        status: 'critical',
        passed: 0.2 * Mt,
        unknownPassages: 0,
        maxJumpMass: null,
        regenerates: false,
      }),
    ).toEqual({ min: 0, max: 0, overdrawn: true });
  });

  it('never runs a regenerating hole down', () => {
    const range = remainingMassRange({
      total: 3 * Mt,
      status: 'fresh',
      passed: 10 * Mt,
      unknownPassages: 3,
      maxJumpMass: 5_000_000,
      regenerates: true,
    });
    expect(range.overdrawn).toBe(false);
    expect(range.min).toBeCloseTo(1.35 * Mt);
  });

  it('counts passages from the moment the status was set', () => {
    const passages = [{ occurredAt: 10 }, { occurredAt: 20 }, { occurredAt: 30 }];
    expect(countedPassages(passages, null)).toHaveLength(3);
    expect(countedPassages(passages, 20)).toEqual([{ occurredAt: 20 }, { occurredAt: 30 }]);
  });

  it('names the statuses a hole may show', () => {
    expect(possibleStatuses({ min: 0.9 * Mt, max: 2.2 * Mt }, 2 * Mt)).toEqual(['fresh', 'reduced']);
    expect(possibleStatuses({ min: 0, max: 0.1 * Mt }, 2 * Mt)).toEqual(['critical']);
    expect(possibleStatuses({ min: 1.5 * Mt, max: 2 * Mt }, 2 * Mt)).toEqual(['fresh']);
    expect(possibleStatuses({ min: 0, max: 1 * Mt }, null)).toEqual([]);
  });
});

describe('rolling plan', () => {
  const J = 375_000_000;

  it('closes a hole on a jump home when one hot return covers the uncertainty', () => {
    const plan = planRoll({
      remaining: { min: 200_000_000, max: 300_000_000 },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Megathron + Higgs', MEGATHRON, { higgs: true })],
    });
    expect(plan).toMatchObject({ result: 'ok', reason: 'collapses' });
    expect(plan.steps.map((s) => [s.direction, s.massMode, s.mass, s.collapse])).toEqual([
      ['out', 'cold', 196_800_000, 'none'],
      ['back', 'hot', 296_800_000, 'will'],
    ]);
    expectSane(plan.steps, J);
  });

  it('goes out cold and comes back hot, creeping up to what is surely left first', () => {
    // A 2 000 000 t hole fresh and unused: 1 800 000-2 200 000 t left.
    const plan = planRoll({
      remaining: { min: 1.8 * Mt, max: 2.2 * Mt },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Megathron', MEGATHRON), ship(1, 'Megathron', MEGATHRON)],
    });
    expectSane(plan.steps, J);
    const firstMay = plan.steps.findIndex((s) => s.collapse !== 'none');
    // Until the hole may close, every jump is safe and returns are hot.
    for (const step of plan.steps.slice(0, firstMay)) {
      expect(step.collapse).toBe('none');
      expect(step.massMode).toBe(step.direction === 'out' ? 'cold' : 'hot');
    }
    // It gets within one trip of the least the hole may have left before anyone takes a risk.
    expect(plan.steps[firstMay - 1]!.usedAfter).toBeGreaterThan(1.8 * Mt - 2 * 148_400_000);
    // 400 000 t of uncertainty is more than one return carries: someone has to risk going out.
    expect(plan).toMatchObject({ result: 'risky', reason: 'strand' });
    expect(plan.steps.at(-1)!.usedAfter).toBeGreaterThanOrEqual(2.2 * Mt);
    expect(plan.steps.at(-1)!.collapse).toBe('will');
  });

  it('takes turns between ships of one kind so nobody waits for polarization', () => {
    const one = planRoll({
      remaining: { min: 1.8 * Mt, max: 2.2 * Mt },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Megathron', MEGATHRON)],
    });
    // One ship doing every trip jumps the same way within five minutes.
    expect(one.steps.slice(2).some((s) => s.polarized)).toBe(true);
    const two = planRoll({
      remaining: { min: 1.8 * Mt, max: 2.2 * Mt },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Megathron 1', MEGATHRON), ship(1, 'Megathron 2', MEGATHRON)],
    });
    expect(two.steps.some((s) => s.polarized)).toBe(false);
    expect(new Set(two.steps.map((s) => s.ship))).toEqual(new Set([0, 1]));
  });

  it('sends the lightest ship out on a critical hole and says it may be stranded', () => {
    const plan = planRoll({
      remaining: { min: 0, max: 220_000_000 },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Megathron', MEGATHRON), ship(1, 'Onyx + entangler', ONYX, { entangler: true })],
    });
    expect(plan).toMatchObject({ result: 'risky', reason: 'strand' });
    expect(plan.steps[0]).toMatchObject({ ship: 1, direction: 'out', mass: 3_080_000, collapse: 'may' });
    expectSane(plan.steps, J);
    expect(plan.steps.at(-1)!.collapse).toBe('will');
  });

  it('uses the Orca back hot and keeps it home', () => {
    const plan = planRoll({
      remaining: { min: 0.5 * Mt, max: 0.9 * Mt },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Orca', ORCA), ship(1, 'Megathron', MEGATHRON)],
    });
    expectSane(plan.steps, J);
    expect(plan.steps.filter((s) => s.direction === 'back').every((s) => s.massMode === 'hot')).toBe(true);
    // The Orca puts the most mass on its way back: it makes the trip that may close it.
    const firstMay = plan.steps.find((s) => s.collapse !== 'none')!;
    expect(firstMay).toMatchObject({ direction: 'back', shipName: 'Orca' });
  });

  it('comes back cold when hot is too heavy for the hole', () => {
    const plan = planRoll({
      remaining: { min: 200_000_000, max: 210_000_000 },
      maxJumpMass: 120_000_000,
      total: 1 * Mt,
      ships: [ship(0, 'Megathron', MEGATHRON)],
    });
    expect(plan.steps.map((s) => [s.direction, s.massMode, s.mass])).toEqual([
      ['out', 'cold', 98_400_000],
      ['back', 'cold', 98_400_000],
    ]);
    // 196 800 t used: any next jump surely closes it, so nobody goes out again.
    expect(plan).toMatchObject({ result: 'risky', reason: 'strand' });
    expectSane(plan.steps, 120_000_000);
  });

  it('cannot plan without the hole’s mass, ships, ships that fit, or a hole', () => {
    const megathron = ship(0, 'Megathron', MEGATHRON);
    expect(planRoll({ remaining: null, maxJumpMass: J, total: null, ships: [megathron] })).toMatchObject({
      result: 'impossible',
      reason: 'unknownType',
    });
    expect(planRoll({ remaining: { min: 0, max: Mt }, maxJumpMass: J, total: Mt, ships: [] })).toMatchObject({
      result: 'impossible',
      reason: 'noShips',
    });
    expect(
      planRoll({ remaining: { min: 0, max: Mt }, maxJumpMass: 5_000_000, total: Mt, ships: [megathron] }),
    ).toMatchObject({ result: 'impossible', reason: 'tooHeavy' });
    expect(
      planRoll({ remaining: { min: 0, max: 0 }, maxJumpMass: J, total: Mt, ships: [megathron] }),
    ).toMatchObject({ result: 'impossible', reason: 'gone' });
    // Any jump out would surely close it with the ship on the far side.
    expect(
      planRoll({ remaining: { min: 0, max: 50_000_000 }, maxJumpMass: J, total: Mt, ships: [megathron] }),
    ).toMatchObject({ result: 'impossible', reason: 'strand', steps: [] });
  });

  it('says to look at the hole when the crew runs out of trips', () => {
    const plan = planRoll({
      remaining: { min: 1.8 * Mt, max: 2.2 * Mt },
      maxJumpMass: J,
      total: 2 * Mt,
      ships: [ship(0, 'Onyx', ONYX)],
      maxTrips: 5,
    });
    expect(plan).toMatchObject({ result: 'risky', reason: 'check' });
    expect(plan.steps).toHaveLength(10);
    expect(plan.steps.at(-1)!.shows).toEqual(['fresh']);
  });
});

describe('pasted fits', () => {
  const FIT = `[Megathron, Roller]
1600mm Rolled Tungsten Compact Plates
1600mm Rolled Tungsten Compact Plates
Damage Control II
[Empty Low slot]

500MN Y-T8 Compact Microwarpdrive
100MN Afterburner II /OFFLINE

Large Higgs Anchor I

Hammerhead II x5
Nanite Repair Paste x100`;
  const ITEMS: Record<string, FitItem> = {
    '1600mm rolled tungsten compact plates': {
      name: '1600mm Rolled Tungsten Compact Plates',
      add: 3_500_000,
    },
    '500mn y-t8 compact microwarpdrive': {
      name: '500MN Y-T8 Compact Microwarpdrive',
      add: 50_000_000,
      prop: true,
    },
    '100mn afterburner ii': { name: '100MN Afterburner II', add: 50_000_000, prop: true },
    'large higgs anchor i': { name: 'Large Higgs Anchor I', percent: 100 },
  };

  it('reads the ship and the fitted items, without cargo, drones, empty slots or offline modules', () => {
    expect(parseFit(FIT)).toEqual({
      shipName: 'Megathron',
      fitName: 'Roller',
      items: [
        '1600mm Rolled Tungsten Compact Plates',
        '1600mm Rolled Tungsten Compact Plates',
        'Damage Control II',
        '500MN Y-T8 Compact Microwarpdrive',
        'Large Higgs Anchor I',
      ],
    });
    expect(parseFit('Megathron')).toBeNull();
  });

  it('weighs plates always, the largest prop module hot, and a Higgs Anchor on everything', () => {
    expect(
      weighFit({ mass: 98_400_000 }, [
        ITEMS['1600mm rolled tungsten compact plates']!,
        ITEMS['500mn y-t8 compact microwarpdrive']!,
        ITEMS['large higgs anchor i']!,
      ]),
    ).toEqual({ cold: 2 * 101_900_000, hot: 2 * 151_900_000, prop: '500MN Y-T8 Compact Microwarpdrive' });
    // A mass entangler is switched on by hand: not part of the fit's weight.
    expect(
      weighFit({ mass: 15_400_000 }, [{ name: 'Zero-Point Mass Entangler', percent: -80 }]),
    ).toMatchObject({
      cold: 15_400_000,
    });
  });

  it('weighs a pasted fit with the catalog', () => {
    const megathron = {
      ...MEGATHRON,
      id: 641,
      name: 'Megathron',
      group: 'Battleship',
      hullClass: 'battleship' as const,
      propSize: 'large' as const,
    };
    const weighed = fitMass(FIT, {
      shipByName: (name) => (name.toLowerCase() === 'megathron' ? megathron : null),
      fitItem: (name) => ITEMS[name.toLowerCase()] ?? null,
    });
    expect(weighed).toMatchObject({
      name: 'Roller',
      cold: 2 * (98_400_000 + 7_000_000),
      hot: 2 * (98_400_000 + 7_000_000 + 50_000_000),
      higgs: true,
    });
    expect(fitMass('[Titan, x]', { shipByName: () => null, fitItem: () => null })).toBeNull();
  });
});
