import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';
import { MassStatus } from './mapping.js';
import { HullClass } from './wormholes.js';

// --- Ships and what changes their mass -------------------------------------------------------

/** Propulsion module sizes: 1MN AB / 5MN MWD, 10MN / 50MN, 100MN / 500MN, 10000MN / 50000MN. */
export const PropSize = z.enum(['small', 'medium', 'large', 'capital']);
export type PropSize = z.infer<typeof PropSize>;

export const PROP_SIZE_LABEL: Record<PropSize, string> = {
  small: '5MN MWD / 1MN AB',
  medium: '50MN MWD / 10MN AB',
  large: '500MN MWD / 100MN AB',
  capital: '50000MN MWD / 10000MN AB',
};

/**
 * A published ship from the SDE: its hull mass, the mass an active prop module of its size adds
 * ("hot") and whether a Higgs Anchor or a Zero-Point Mass Entangler fits it. Masses in kg.
 */
export const ShipTypeDto = z.object({
  id: EveId,
  name: z.string(),
  /** SDE group, e.g. "Battleship", "Heavy Interdiction Cruiser". */
  group: z.string(),
  hullClass: HullClass.nullable(),
  mass: z.number(),
  /** The prop module size it fits; null when it has no mid slot (freighters, shuttles). */
  propSize: PropSize.nullable(),
  /** What an active prop module of that size adds (SDE `massAddition`); null without one. */
  propMass: z.number().nullable(),
  /** It has rig slots: a Higgs Anchor fits. */
  higgs: z.boolean(),
  /** A Zero-Point Mass Entangler fits (heavy interdiction cruisers, the Odysseus). */
  entangler: z.boolean(),
});
export type ShipTypeDto = z.infer<typeof ShipTypeDto>;

/**
 * Mass modules from SDE dogma: prop modules add `massAddition` while active, Higgs Anchors
 * (+100 %) and the Zero-Point Mass Entangler (-80 %) scale the result (`massBonusPercentage`,
 * applied after additions as dogma orders post-percent modifiers).
 */
export const MassModifiersDto = z.object({
  prop: z.record(PropSize, z.number()),
  higgsPercent: z.number(),
  entanglerPercent: z.number(),
});
export type MassModifiersDto = z.infer<typeof MassModifiersDto>;

/** GET /api/universe/ships?q= */
export const ShipSearchQuery = z.object({
  q: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ShipSearchQuery = z.infer<typeof ShipSearchQuery>;

/** GET /api/universe/ships/catalog: what the dialogs need to show masses without asking again. */
export const ShipCatalogDto = z.object({
  modifiers: MassModifiersDto,
  /** A few ships people roll with, to pick from before searching. */
  suggested: z.array(ShipTypeDto),
});
export type ShipCatalogDto = z.infer<typeof ShipCatalogDto>;

// --- Passages ---------------------------------------------------------------------------------

/** `tracked`: a tracked character's jump; `manual`: logged by hand ("Log a jump"). */
export const PassageSource = z.enum(['tracked', 'manual']);
export type PassageSource = z.infer<typeof PassageSource>;

/**
 * How the ship's mass was counted: `cold` the hull, `hot` with its prop module running (the game
 * counts the mass at the moment of the jump), `custom` a mass someone typed.
 */
export const MassMode = z.enum(['cold', 'hot', 'custom']);
export type MassMode = z.infer<typeof MassMode>;

/** What a ship had on when it jumped. */
export interface PassageFit {
  massMode: MassMode;
  higgs?: boolean;
  entangler?: boolean;
  /** kg, for `custom`. */
  mass?: number | null;
}

/** The parts of a ship the mass depends on. */
export type ShipMassFacts = Pick<ShipTypeDto, 'mass' | 'propMass' | 'higgs' | 'entangler'>;

/**
 * Mass (kg) a jump puts on a wormhole: (hull + active prop module) scaled by a Higgs Anchor and a
 * mass entangler, each only where it fits. One bonus and one malus each count in full (dogma
 * penalises stacked modifiers of the same sign only). Null when the ship is unknown and no
 * custom mass is given.
 */
export function jumpMass(
  ship: ShipMassFacts | null | undefined,
  fit: PassageFit,
  modifiers: MassModifiersDto,
): number | null {
  if (fit.massMode === 'custom') return fit.mass ?? null;
  if (!ship) return null;
  const added = fit.massMode === 'hot' ? (ship.propMass ?? 0) : 0;
  let factor = 1;
  if (fit.higgs && ship.higgs) factor *= 1 + modifiers.higgsPercent / 100;
  if (fit.entangler && ship.entangler) factor *= 1 + modifiers.entanglerPercent / 100;
  return Math.round((ship.mass + added) * factor);
}

/** A ship that went through a connection: a tracked character's jump or one logged by hand. */
export const PassageDto = z.object({
  id: Id,
  connectionId: Id,
  /** Null for passages logged by hand (or on a merged map that does not share characters). */
  characterId: EveId.nullable(),
  /** The pilot's name, when known. */
  characterName: z.string().nullable().optional(),
  shipTypeId: EveId.nullable(),
  /** The ship type's name from the SDE, when known. */
  shipName: z.string().nullable().optional(),
  /** Mass the jump put on the hole (kg); null when the ship type is unknown. */
  mass: z.number().nullable(),
  from: EveId,
  to: EveId,
  occurredAt: Timestamp,
  /** Optional for readers of passages from before they were told apart (all tracked). */
  source: PassageSource.optional(),
  massMode: MassMode.optional(),
  higgs: z.boolean().optional(),
  entangler: z.boolean().optional(),
  note: z.string().nullable().optional(),
  /** Counted by the mass estimate: on or after the moment the mass status was set or the counter reset. */
  counted: z.boolean().optional(),
  /** On a merged map, the map that recorded it (passages stay with their source map); it is read-only there. */
  recordedOn: z.string().nullable().optional(),
});
export type PassageDto = z.infer<typeof PassageDto>;

/** Which way a ship went, from the connection's point of view. */
export const PassageDirection = z.enum(['sourceToTarget', 'targetToSource']);
export type PassageDirection = z.infer<typeof PassageDirection>;

/** POST /api/maps/:mapId/connections/:connectionId/passages: "Log a jump" for pilots nobody tracks. */
export const LogPassagesRequest = z
  .strictObject({
    shipTypeId: EveId,
    direction: PassageDirection,
    massMode: MassMode.default('cold'),
    higgs: z.boolean().optional(),
    entangler: z.boolean().optional(),
    /** kg; required for `custom`. */
    mass: z.number().positive().max(10_000_000_000).optional(),
    note: z.string().trim().max(200).optional(),
    /** Several jumps of the same ship the same way (e.g. 3 jumps). */
    count: z.number().int().min(1).max(20).default(1),
    /** When it happened; now when omitted. */
    occurredAt: Timestamp.optional(),
  })
  .refine((r) => r.massMode !== 'custom' || r.mass !== undefined, {
    message: 'A custom mass needs the mass',
    path: ['mass'],
  });
export type LogPassagesRequest = z.input<typeof LogPassagesRequest>;

/** PATCH /api/maps/:mapId/connections/:connectionId/passages/:passageId */
export const UpdatePassageRequest = z
  .strictObject({
    massMode: MassMode.optional(),
    higgs: z.boolean().optional(),
    entangler: z.boolean().optional(),
    mass: z.number().positive().max(10_000_000_000).optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((r) => r.massMode !== 'custom' || r.mass !== undefined, {
    message: 'A custom mass needs the mass',
    path: ['mass'],
  });
export type UpdatePassageRequest = z.input<typeof UpdatePassageRequest>;

// --- Rolling ----------------------------------------------------------------------------------

/** A mass range in kg. */
export const MassRange = z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() });
export type MassRange = z.infer<typeof MassRange>;

/** One kind of ship the rolling crew has, and how many of them. */
export const RollShipRequest = z.strictObject({
  shipTypeId: EveId,
  higgs: z.boolean().optional(),
  entangler: z.boolean().optional(),
  count: z.number().int().min(1).max(5).default(1),
});
export type RollShipRequest = z.input<typeof RollShipRequest>;

/** POST /api/maps/:mapId/connections/:connectionId/roll-plan */
export const RollPlanRequest = z.strictObject({
  ships: z.array(RollShipRequest).min(1).max(8),
  /** What is left of the hole, when the crew knows better than the estimate. */
  remaining: MassRange.refine((r) => r.min <= r.max, 'min must not exceed max').optional(),
});
export type RollPlanRequest = z.input<typeof RollPlanRequest>;

/** `ok`: collapses on a jump home with nobody stranded; `risky`: needs a look in between or may strand someone. */
export const RollResult = z.enum(['ok', 'risky', 'impossible']);
export type RollResult = z.infer<typeof RollResult>;

/**
 * Why a plan came out as it did. `collapses`: the last jump home closes it whatever the hole's
 * real mass. `check`: the plan runs out of safe jumps before it must collapse; look at the hole and
 * set its mass status. `strand`: a jump out may close the hole behind the ship. `noShips`,
 * `tooHeavy`: nothing that may jump. `unknownType`: the hole's type (and so its mass) is unknown.
 * `gone`: by the estimate the hole should have collapsed already. `regenerates`: it regains its
 * mass faster than a crew can use it (frigate holes), so it cannot be rolled.
 */
export const RollReason = z.enum([
  'collapses',
  'check',
  'strand',
  'noShips',
  'tooHeavy',
  'unknownType',
  'gone',
  'regenerates',
]);
export type RollReason = z.infer<typeof RollReason>;

/** `none`: cannot collapse it; `may`: may collapse it; `will`: collapses it whatever the hole's real mass. */
export const RollRisk = z.enum(['none', 'may', 'will']);
export type RollRisk = z.infer<typeof RollRisk>;

export const RollStepDto = z.object({
  /** Which ship of the crew (0-based, in the order sent; a kind with count 2 is two ships). */
  ship: z.number().int(),
  shipTypeId: EveId,
  shipName: z.string(),
  /** `out`: away from home (through to the far side); `back`: home again. */
  direction: z.enum(['out', 'back']),
  massMode: z.enum(['cold', 'hot']),
  mass: z.number(),
  /** Mass on the hole after this jump, counted from the start of the plan. */
  usedAfter: z.number(),
  /** What may be left after it, if it is still open. */
  remainingAfter: MassRange,
  /** Whether this jump may close the hole: harmless going back, strands the ship going out. */
  collapse: RollRisk,
  /** The pilot jumped this way less than five minutes before: wait for polarization to end. */
  polarized: z.boolean(),
  /** The mass statuses the hole may show after this jump, if still open. */
  shows: z.array(MassStatus),
});
export type RollStepDto = z.infer<typeof RollStepDto>;

export const RollCrewShipDto = z.object({
  shipTypeId: EveId,
  name: z.string(),
  cold: z.number(),
  hot: z.number(),
  /** Too heavy for this hole even cold. */
  tooHeavy: z.boolean(),
});
export type RollCrewShipDto = z.infer<typeof RollCrewShipDto>;

export const RollPlanDto = z.object({
  result: RollResult,
  reason: RollReason,
  /** What was left when the plan starts; null when unknown. */
  remaining: MassRange.nullable(),
  maxJumpMass: z.number().nullable(),
  crew: z.array(RollCrewShipDto),
  steps: z.array(RollStepDto),
});
export type RollPlanDto = z.infer<typeof RollPlanDto>;

/** Polarization: "You may not jump through a wormhole in the same direction twice within five minutes." */
export const POLARIZATION_MS = 5 * 60 * 1000;
