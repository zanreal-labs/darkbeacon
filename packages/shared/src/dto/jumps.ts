import { z } from 'zod';
import { EveId, Timestamp } from './common.js';

/**
 * Jump planner: capital jump routes across known space (docs/decisions.md, "Jump planner").
 * Ships, ranges and fuel come from the SDE; the rules from the sources cited there.
 */

/** Hulls with a jump drive, as SDE ship groups make them. */
export const JUMP_HULLS = [
  'jump_freighter',
  'black_ops',
  'rorqual',
  'carrier',
  'command_carrier',
  'dreadnought',
  'lancer',
  'force_auxiliary',
  'supercarrier',
  'titan',
] as const;
export const JumpHull = z.enum(JUMP_HULLS);
export type JumpHull = z.infer<typeof JumpHull>;

export const Isotope = z.enum(['helium', 'hydrogen', 'nitrogen', 'oxygen']);
export type Isotope = z.infer<typeof Isotope>;

/** The cynosural field a hull jumps to most cheaply: covert (black ops), industrial or a normal one. */
export const CynoKind = z.enum(['regular', 'industrial', 'covert']);
export type CynoKind = z.infer<typeof CynoKind>;

const SkillLevel = z.number().int().min(0).max(5);

/** Jump Drive Calibration (range), Jump Fuel Conservation and Jump Freighters (fuel). */
export const JumpSkills = z.object({
  jdc: SkillLevel.default(5),
  jfc: SkillLevel.default(4),
  jf: SkillLevel.default(4),
});
export type JumpSkills = z.infer<typeof JumpSkills>;

/** A ship the planner knows, with its SDE values. */
export const JumpShipDto = z.object({
  typeId: EveId,
  name: z.string(),
  hull: JumpHull,
  /** Base range in light years (before Jump Drive Calibration). */
  rangeLy: z.number(),
  /** Isotopes per light year before skills. */
  fuelPerLy: z.number(),
  isotope: Isotope,
  /** Share of the distance that counts for fatigue: 0.1 jump freighters and Rorqual, 0.25 black ops. */
  fatigueMultiplier: z.number(),
  /** Hull mass in kg. */
  mass: z.number(),
  /** Can bridge other ships (titan portal, black ops covert portal). */
  bridges: z.boolean(),
  /** May travel in high-sec (jump freighters and black ops): jump out of it, take its gates. */
  highSec: z.boolean(),
  /** May use Ansiblex jump bridges. */
  ansiblex: z.boolean(),
  cyno: CynoKind,
});
export type JumpShipDto = z.infer<typeof JumpShipDto>;

export const JumpMetaDto = z.object({
  /** Version of the k-space dataset (a hash); part of the dataset's address. */
  version: z.string(),
  /** The SDE build it was made from. */
  source: z.string(),
  ships: z.array(JumpShipDto),
  /** Range bonus per level of Jump Drive Calibration (0.2 = 20 %). */
  rangeBonusPerLevel: z.number(),
  /** Ansiblex bridges link systems at most this far apart. */
  ansiblexRangeLy: z.number(),
});
export type JumpMetaDto = z.infer<typeof JumpMetaDto>;

/**
 * Known space for the planner's map, columnar: index `i` of every `systems` array is one system.
 * Positions in light years (x east, y up, z north); `gates` are index pairs.
 */
export const JumpUniverseDto = z.object({
  version: z.string(),
  source: z.string(),
  regions: z.array(z.object({ id: EveId, name: z.string() })),
  systems: z.object({
    id: z.array(z.number()),
    name: z.array(z.string()),
    region: z.array(z.number()),
    security: z.array(z.number()),
    x: z.array(z.number()),
    y: z.array(z.number()),
    z: z.array(z.number()),
    /** 1 NPC station, 2 Pochven, 4 Zarzakh. */
    flags: z.array(z.number()),
  }),
  gates: z.array(z.number()),
});
export type JumpUniverseDto = z.infer<typeof JumpUniverseDto>;

export const JUMP_FLAG_STATION = 1;
export const JUMP_FLAG_POCHVEN = 2;
export const JUMP_FLAG_ZARZAKH = 4;

export const JumpUniverseQuery = z.object({ v: z.string().max(64).optional() });

/**
 * How stargates may be used, always after the last jump: never; `finish`, only where no jump
 * reaches (into high-sec); `shortcut`, also where a gate saves a jump (a destination one gate on).
 */
export const JumpGateUse = z.enum(['never', 'finish', 'shortcut']);
export type JumpGateUse = z.infer<typeof JumpGateUse>;

export const JumpPlanRequest = z.object({
  shipTypeId: EveId,
  origin: EveId,
  destination: EveId,
  skills: JumpSkills.default({ jdc: 5, jfc: 4, jf: 4 }),
  avoidSystems: z.array(EveId).max(500).default([]),
  avoidRegions: z.array(EveId).max(100).default([]),
  /** Rather stop in systems with an NPC station, even at the cost of more fuel. */
  preferStations: z.boolean().default(false),
  gates: JumpGateUse.default('finish'),
  /** Never enter high-sec, as the `outlaw` route mode. */
  outlaw: z.boolean().default(false),
  /** The pilot's own Ansiblex jump bridges. */
  ansiblex: z
    .array(z.object({ from: EveId, to: EveId }))
    .max(200)
    .default([]),
  /** Wait between jumps so fatigue stays at or under this (minutes). */
  maxFatigueMinutes: z.number().int().min(10).max(300).nullable().default(null),
  /** Fatigue the pilot has now (minutes). */
  fatigueNowMinutes: z.number().int().min(0).max(300).default(0),
  /** Mass bridged at every leg (tonnes), for titan and black ops bridge fuel. */
  bridgeTonnes: z.number().min(0).max(100_000_000).nullable().default(null),
});
export type JumpPlanRequest = z.input<typeof JumpPlanRequest>;
export type JumpPlanInput = z.output<typeof JumpPlanRequest>;

export const JumpSystemRefDto = z.object({
  id: EveId,
  name: z.string(),
  security: z.number(),
  region: z.string(),
  station: z.boolean(),
});
export type JumpSystemRefDto = z.infer<typeof JumpSystemRefDto>;

export const JumpLegKind = z.enum(['jump', 'gate', 'ansiblex']);
export type JumpLegKind = z.infer<typeof JumpLegKind>;

export const JumpLegDto = z.object({
  kind: JumpLegKind,
  from: JumpSystemRefDto,
  to: JumpSystemRefDto,
  /** Straight-line distance in light years. */
  ly: z.number(),
  /** Isotopes for this leg (0 for gates and Ansiblex). */
  fuel: z.number().int(),
  /** Isotopes a bridge for `bridgeTonnes` costs on this leg; null without bridging. */
  bridgeFuel: z.number().int().nullable(),
  /** Minutes to wait before this leg: the activation timer, or longer to keep fatigue under the cap. */
  waitMinutes: z.number(),
  /** Jump activation timer after the leg (minutes). */
  activationMinutes: z.number(),
  /** Jump fatigue after the leg (minutes). */
  fatigueMinutes: z.number(),
});
export type JumpLegDto = z.infer<typeof JumpLegDto>;

export const JumpProblem = z.enum([
  'unknown_ship',
  'unknown_system',
  'same_system',
  'origin_not_allowed',
  'destination_not_allowed',
  'no_route',
]);
export type JumpProblem = z.infer<typeof JumpProblem>;

export const JumpPlanDto = z.object({
  ship: JumpShipDto,
  /** Range with the given Jump Drive Calibration. */
  rangeLy: z.number(),
  route: z
    .object({
      legs: z.array(JumpLegDto),
      jumps: z.number().int(),
      gates: z.number().int(),
      ansiblex: z.number().int(),
      /** Light years jumped. */
      ly: z.number(),
      fuel: z.number().int(),
      bridgeFuel: z.number().int().nullable(),
      /** Waiting between legs (minutes); gate travel is not counted. */
      waitMinutes: z.number(),
      fatigueMinutes: z.number(),
      activationMinutes: z.number(),
      /** Things the pilot should know, one sentence each. */
      notes: z.array(z.string()),
    })
    .nullable(),
  problem: z.object({ code: JumpProblem, message: z.string() }).nullable(),
  /** Ansiblex pairs that were left out (too far apart, or not usable by this hull). */
  ignoredAnsiblex: z.array(z.object({ from: EveId, to: EveId, why: z.string() })),
});
export type JumpPlanDto = z.infer<typeof JumpPlanDto>;

/**
 * GET /api/jumps/pilots/:characterId: one of my characters' jump skills and fatigue from ESI, to
 * fill the planner (the opt-in extra `jumps`: `esi-skills.read_skills.v1` and
 * `esi-characters.read_fatigue.v1`).
 */
export const JumpPilotDto = z.object({
  characterId: EveId,
  /** Active levels (an alpha clone's are capped); null without the scope or an answer from ESI. */
  skills: z.object({ jdc: SkillLevel, jfc: SkillLevel, jf: SkillLevel }).nullable(),
  /** Fatigue left when this was read (minutes, at most 300); null when it is not known. */
  fatigueMinutes: z.number().int().min(0).max(300).nullable(),
  /** When the fatigue runs out (epoch ms); null without fatigue or when it is not known. */
  fatigueExpiresAt: Timestamp.nullable(),
  /** Scopes of the extra the character's grant lacks; linking it again with `jumps` adds them. */
  missingScopes: z.array(z.string()),
  /** Why ESI gave nothing for a part the grant covers, in one sentence; null when it answered. */
  problem: z.string().nullable(),
  checkedAt: Timestamp,
});
export type JumpPilotDto = z.infer<typeof JumpPilotDto>;

/**
 * Whole minutes of fatigue left at `now` for fatigue that runs out at `expiresAt`, rounded up and
 * capped at the 300 minutes fatigue can reach. Fatigue falls a minute per minute, so it is worked
 * out when a route is planned, not when ESI was asked.
 */
export function fatigueMinutesLeft(expiresAt: number | null, now: number): number {
  if (expiresAt === null) return 0;
  return Math.min(300, Math.max(0, Math.ceil((expiresAt - now) / 60_000)));
}
