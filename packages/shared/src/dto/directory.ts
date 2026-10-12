import { z } from 'zod';
import { EveId } from './common.js';

// ---- EVE directory: names and search for pickers, so the UI never asks for raw ids ------------

export const EveEntityCategory = z.enum(['character', 'corporation', 'alliance']);
export type EveEntityCategory = z.infer<typeof EveEntityCategory>;

export const EveEntityDto = z.object({
  id: EveId,
  name: z.string(),
  category: EveEntityCategory,
  /** Corporation and alliance tickers, when ESI gave one. */
  ticker: z.string().nullable(),
});
export type EveEntityDto = z.infer<typeof EveEntityDto>;

/** GET /api/eve/search?category=&q= */
export const EveSearchQuery = z.object({
  category: EveEntityCategory,
  q: z.string().trim().min(1).max(100),
});
export type EveSearchQuery = z.infer<typeof EveSearchQuery>;

export const EveSearchResultDto = z.object({
  results: z.array(EveEntityDto),
  /**
   * `search`: ESI search through one of the caller's characters. `exact`: exact names only,
   * because none of the caller's characters may search or the text is shorter than ESI allows.
   */
  mode: z.enum(['search', 'exact']),
  /** The caller has characters, but none whose token allows search: re-linking one enables it. */
  relinkToSearch: z.boolean(),
});
export type EveSearchResultDto = z.infer<typeof EveSearchResultDto>;

/** GET /api/eve/entities?ids=1,2,3 (up to 500): names and tickers of characters, corporations, alliances. */
export const EveEntitiesQuery = z.object({
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'comma separated ids')
    .transform((s) => [...new Set(s.split(',').map(Number))])
    .pipe(z.array(EveId).min(1).max(500)),
});
export type EveEntitiesQuery = z.infer<typeof EveEntitiesQuery>;

// ---- Discord: an optional instance bot, for picking servers, roles and channels by name --------

export const DiscordBotDto = z.object({
  configured: z.boolean(),
  /** The bot's user name and avatar, when connected. */
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** Adds the bot to a server with the permissions Darkbeacon needs. */
  inviteUrl: z.string().nullable(),
  /** The last error Discord gave for the bot's token (revoked, missing access). */
  error: z.string().nullable(),
});
export type DiscordBotDto = z.infer<typeof DiscordBotDto>;

export const SetDiscordBotRequest = z.object({ token: z.string().trim().min(20).max(200) });
export type SetDiscordBotRequest = z.infer<typeof SetDiscordBotRequest>;

export const DiscordGuildDto = z.object({
  id: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
});
export type DiscordGuildDto = z.infer<typeof DiscordGuildDto>;

export const DiscordRoleDto = z.object({
  id: z.string(),
  name: z.string(),
  /** #rrggbb, or null for roles without a colour. */
  color: z.string().nullable(),
  /** Roles managed by an integration (bots, boosts) cannot be handed out. */
  managed: z.boolean(),
});
export type DiscordRoleDto = z.infer<typeof DiscordRoleDto>;

export const DiscordChannelDto = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['text', 'announcement']),
  /** The category the channel sits in. */
  category: z.string().nullable(),
});
export type DiscordChannelDto = z.infer<typeof DiscordChannelDto>;
