import { z } from 'zod';
import { EveId, Timestamp } from './common.js';

// System intel: public game data about systems on a map. Sovereignty and hourly activity come from
// ESI, killmails from zKillboard. Nothing here is about a map or its people, so one cache serves
// every map; a map only decides which systems it asks about.

/** Kills in the last hour from which a system counts as busy, and as very busy. */
export const KILLS_HOT = 5;
export const KILLS_VERY_HOT = 20;

export type KillHeat = 'none' | 'active' | 'hot' | 'very-hot';

/** How busy a system is from its kills in the last hour (the node colours only `hot` and up). */
export function killHeat(kills: number): KillHeat {
  if (kills >= KILLS_VERY_HOT) return 'very-hot';
  if (kills >= KILLS_HOT) return 'hot';
  return kills > 0 ? 'active' : 'none';
}

/** An alliance, corporation, character, faction or ship type with what ESI calls it. */
export const IntelEntityDto = z.object({
  id: EveId,
  /** Null until ESI named it (or when ESI does not know it). */
  name: z.string().nullable(),
  /** Alliances and corporations; a faction's short name ("Guristas"); null otherwise. */
  ticker: z.string().nullable(),
});
export type IntelEntityDto = z.infer<typeof IntelEntityDto>;

export const SovereigntyKind = z.enum(['alliance', 'faction']);
export type SovereigntyKind = z.infer<typeof SovereigntyKind>;

/** Who holds a system: a player alliance (with the corporation that claimed it) or an NPC faction. */
export const SovereigntyDto = z.object({
  kind: SovereigntyKind,
  holder: IntelEntityDto,
  /** The claiming corporation of an alliance claim. */
  corporation: IntelEntityDto.nullable(),
});
export type SovereigntyDto = z.infer<typeof SovereigntyDto>;

/** What a node shows about a system: who holds it and how busy it is. */
export const SystemIntelDto = z.object({
  solarSystemId: EveId,
  /** Null in wormhole space, high- and low-sec (empire factions are not shown) and unclaimed systems. */
  sovereignty: SovereigntyDto.nullable(),
  /** For an unclaimed null-sec system: the alliance holding most of its region, if one does. */
  regionHolder: z
    .object({
      region: z.string(),
      holder: IntelEntityDto,
      held: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .nullable(),
  /**
   * Ships and pods destroyed in the last hour: zKillboard's killmails of the last 60 minutes when
   * the system's kills are followed live, else the larger of that and ESI's last hourly figure.
   */
  kills1h: z.number().int().nonnegative(),
  /** ESI's last hourly figures; null before ESI answered and in wormhole space (ESI has none). */
  npcKills1h: z.number().int().nonnegative().nullable(),
  jumps1h: z.number().int().nonnegative().nullable(),
  /** Time of the newest killmail known for the system. */
  lastKillAt: Timestamp.nullable(),
});
export type SystemIntelDto = z.infer<typeof SystemIntelDto>;

/** `GET /api/maps/:mapId/intel`: every system on the map that has something to show. */
export const MapIntelDto = z.object({
  systems: z.array(SystemIntelDto),
  /** Whether killmails are followed live (zKillboard's feed); counts are ESI's hourly ones otherwise. */
  live: z.boolean(),
});
export type MapIntelDto = z.infer<typeof MapIntelDto>;

/** Pilots of one corporation (and its alliance) on a killmail. */
export const KillGroupDto = z.object({
  corporation: IntelEntityDto.nullable(),
  alliance: IntelEntityDto.nullable(),
  pilots: z.number().int().positive(),
});
export type KillGroupDto = z.infer<typeof KillGroupDto>;

export const KillParticipantDto = z.object({
  character: IntelEntityDto.nullable(),
  corporation: IntelEntityDto.nullable(),
  alliance: IntelEntityDto.nullable(),
  ship: IntelEntityDto.nullable(),
});
export type KillParticipantDto = z.infer<typeof KillParticipantDto>;

export const KillmailDto = z.object({
  id: EveId,
  solarSystemId: EveId,
  time: Timestamp,
  /** zKillboard's estimate in ISK. */
  value: z.number().nonnegative().nullable(),
  /** Killed by NPCs only. */
  npc: z.boolean(),
  solo: z.boolean(),
  victim: KillParticipantDto,
  finalBlow: KillParticipantDto.nullable(),
  attackerCount: z.number().int().nonnegative(),
  /** The attackers' corporations, most pilots first (at most five). */
  attackers: z.array(KillGroupDto),
});
export type KillmailDto = z.infer<typeof KillmailDto>;

/** One hour of ESI's figures; a figure ESI did not give for that hour is null. */
export const ActivityHourDto = z.object({
  /** Start of the hour (epoch ms). */
  hour: Timestamp,
  shipKills: z.number().int().nonnegative().nullable(),
  podKills: z.number().int().nonnegative().nullable(),
  npcKills: z.number().int().nonnegative().nullable(),
  jumps: z.number().int().nonnegative().nullable(),
  /**
   * zKillboard's killmails in that hour, when the system's killmails are complete for it (the only
   * hourly kill figure of wormhole space, which ESI leaves out).
   */
  killmails: z.number().int().nonnegative().nullable(),
});
export type ActivityHourDto = z.infer<typeof ActivityHourDto>;

export const ActivityWindow = z.enum(['1h', '24h', '7d']);
export type ActivityWindow = z.infer<typeof ActivityWindow>;

/** A corporation or alliance seen on killmails in a window: as attacker (kills) or victim (losses). */
export const ActiveGroupDto = z.object({
  kind: z.enum(['corporation', 'alliance']),
  entity: IntelEntityDto,
  kills: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type ActiveGroupDto = z.infer<typeof ActiveGroupDto>;

/** `GET /api/maps/:mapId/intel/systems/:solarSystemId`: the sidebar's Activity section. */
export const SystemActivityDto = z.object({
  intel: SystemIntelDto,
  /** The last 24 hours, oldest first. */
  hours: z.array(ActivityHourDto),
  /** Newest first. */
  kills: z.array(KillmailDto),
  groups: z.object({
    '1h': z.array(ActiveGroupDto),
    '24h': z.array(ActiveGroupDto),
    '7d': z.array(ActiveGroupDto),
  }),
  /** Killmails are complete from this time on (null: none fetched for this system yet). */
  coveredSince: Timestamp.nullable(),
});
export type SystemActivityDto = z.infer<typeof SystemActivityDto>;

/** `GET /api/maps/:mapId/kills`: killmails of the map's systems, newest first. */
export const MapKillsQuery = z.object({
  /** How far back, in hours (at most a week). */
  hours: z.coerce.number().int().min(1).max(168).default(24),
  /** Only these systems (comma separated); default every visible system of the map. */
  systems: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((v) => v.split(',').map(Number))
    .optional(),
  /** Only systems in wormhole space. */
  wormholes: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MapKillsQuery = z.infer<typeof MapKillsQuery>;

export const MapKillsDto = z.object({ kills: z.array(KillmailDto) });
export type MapKillsDto = z.infer<typeof MapKillsDto>;

/**
 * `GET /api/accounts/me/standings`: how the signed-in account stands towards alliances,
 * corporations and characters, from its characters' contacts (alliance over corporation over
 * character, the main character first) and +10 for its own alliances and corporations.
 */
export const StandingsDto = z.object({
  standings: z.array(z.object({ id: EveId, standing: z.number().min(-10).max(10) })),
  /** Some linked characters lack the contact scopes (linked before they were asked for). */
  missingScopes: z.boolean(),
});
export type StandingsDto = z.infer<typeof StandingsDto>;

export type StandingTone = 'excellent' | 'good' | 'neutral' | 'bad' | 'terrible';

/** The game's five standing colours: above +5, above 0, 0, down to -5, below -5. */
export function standingTone(standing: number | null | undefined): StandingTone {
  if (standing === null || standing === undefined || standing === 0) return 'neutral';
  if (standing > 5) return 'excellent';
  if (standing > 0) return 'good';
  if (standing >= -5) return 'bad';
  return 'terrible';
}

/**
 * The status an unmarked system takes from its holder's standing (per viewer): friendly from +5,
 * warning from -5, hostile at -10. A status someone set always wins.
 */
export function statusFromStanding(
  standing: number | null | undefined,
): 'friendly' | 'warning' | 'hostile' | null {
  if (standing === null || standing === undefined) return null;
  if (standing >= 5) return 'friendly';
  if (standing <= -10) return 'hostile';
  if (standing <= -5) return 'warning';
  return null;
}
