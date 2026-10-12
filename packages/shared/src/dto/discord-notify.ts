import { z } from 'zod';
import { Timestamp } from './common.js';

/*
 * Discord notifications of a map. Served by the bundled `discord-notify` plugin under
 * /api/plugins/discord-notify/maps/:mapId (map admins), shown in the map's Notifications tab.
 */

/** What a map can post to Discord, in the words the settings use. */
export const DiscordNotifyKind = z.enum([
  /** A new connection, called out louder when it opens an exit to known space. */
  'connections',
  /** A connection marked end of life or critical mass. */
  'eol',
  /** A connection marked dangerous or bubbled, a system marked hostile. */
  'danger',
  /** Kills in a system on the map (from zKillboard). */
  'kills',
  /** Rally pings. */
  'pings',
  /** A summary of the exits to known space when they change (at most every 15 minutes). */
  'wayHome',
  /** Tracked characters entering the chain from outside it. */
  'arrivals',
]);
export type DiscordNotifyKind = z.infer<typeof DiscordNotifyKind>;

/** Kinds that may mention @here or a role. */
export const DISCORD_URGENT_KINDS = [
  'eol',
  'danger',
  'kills',
  'pings',
] as const satisfies readonly DiscordNotifyKind[];

const Snowflake = z.string().regex(/^\d{1,20}$/, 'must be a Discord id');

export const DiscordWebhookUrl = z
  .string()
  .trim()
  .regex(
    /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{1,20}\/[\w-]{20,200}$/,
    'paste the webhook URL from the channel settings (Integrations, Webhooks)',
  );

/** Where messages go: a channel webhook, or a channel the instance bot can post in. */
export const DiscordNotifyTargetInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webhook'), url: DiscordWebhookUrl }),
  z.object({ kind: z.literal('channel'), guildId: Snowflake, channelId: Snowflake }),
]);
export type DiscordNotifyTargetInput = z.infer<typeof DiscordNotifyTargetInput>;

/** The target as shown back: webhook URLs carry a secret, so only a description comes back. */
export const DiscordNotifyTargetDto = z.object({
  kind: z.enum(['webhook', 'channel']),
  /** "#alerts on Hard Knocks", or the webhook's name. */
  label: z.string(),
  guildId: z.string().nullable(),
  channelId: z.string().nullable(),
});
export type DiscordNotifyTargetDto = z.infer<typeof DiscordNotifyTargetDto>;

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const QuietHours = z.object({
  enabled: z.boolean(),
  /** Local time in `timeZone`, e.g. 23:00. */
  start: Clock,
  end: Clock,
  /** IANA time zone, e.g. Europe/Warsaw or UTC (EVE time). */
  timeZone: z.string().min(1).max(64),
});
export type QuietHours = z.infer<typeof QuietHours>;

export const DiscordMention = z.object({
  kind: z.enum(['none', 'here', 'role']),
  /** With `role`: the role to mention (picked from the bot's list). */
  roleId: Snowflake.nullable(),
  /** Which urgent kinds mention; the others post quietly. */
  kinds: z.array(z.enum(DISCORD_URGENT_KINDS)),
});
export type DiscordMention = z.infer<typeof DiscordMention>;

export const DiscordNotifySettings = z.object({
  enabled: z.boolean(),
  kinds: z.record(DiscordNotifyKind, z.boolean()),
  mention: DiscordMention,
  quietHours: QuietHours,
});
export type DiscordNotifySettings = z.infer<typeof DiscordNotifySettings>;

export const DiscordNotifyStateDto = DiscordNotifySettings.extend({
  target: DiscordNotifyTargetDto.nullable(),
  /** A bot is connected on this instance, so a server and channel can be picked. */
  bot: z.boolean(),
  status: z.object({
    lastSentAt: Timestamp.nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: Timestamp.nullable(),
    /** Messages waiting for their batch or a retry. */
    pending: z.number().int().nonnegative(),
  }),
});
export type DiscordNotifyStateDto = z.infer<typeof DiscordNotifyStateDto>;

/** PUT: a partial update; `target: null` disconnects, leaving it out keeps the current one. */
export const UpdateDiscordNotifyRequest = DiscordNotifySettings.partial().extend({
  target: DiscordNotifyTargetInput.nullable().optional(),
});
export type UpdateDiscordNotifyRequest = z.infer<typeof UpdateDiscordNotifyRequest>;

export const DiscordNotifyTestDto = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type DiscordNotifyTestDto = z.infer<typeof DiscordNotifyTestDto>;
