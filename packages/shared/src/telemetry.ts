import { z } from 'zod';

/**
 * Anonymous product telemetry: the allow-list of what an instance may report to the maintainers
 * (see docs/telemetry.md). Every event and every property is listed here or in the telemetry
 * module; anything else is refused before it leaves the server. Properties are enums, booleans,
 * buckets or small integers: never names, ids, free text, IPs or anything a person typed.
 */

/** Plugins shipped in this repository; any other plugin is only counted. */
export const FIRST_PARTY_PLUGIN_IDS = ['discord-notify', 'sample-widget'] as const;
export const FirstPartyPluginId = z.enum(FIRST_PARTY_PLUGIN_IDS);

/** Built-in themes, `system` and the first-party theme packages; any other theme is `custom`. */
export const FIRST_PARTY_THEME_IDS = ['system', 'default', 'dark', 'contrast', 'amarr'] as const;
export const TelemetryThemeId = z.enum([...FIRST_PARTY_THEME_IDS, 'custom']);
export type TelemetryThemeId = z.infer<typeof TelemetryThemeId>;

export function telemetryThemeId(id: string): TelemetryThemeId {
  return (FIRST_PARTY_THEME_IDS as readonly string[]).includes(id) ? (id as TelemetryThemeId) : 'custom';
}

export const COUNT_BUCKETS = [
  '0',
  '1',
  '2-5',
  '6-10',
  '11-25',
  '26-50',
  '51-100',
  '101-250',
  '251-1000',
  '1001+',
] as const;
export const CountBucket = z.enum(COUNT_BUCKETS);
export type CountBucket = z.infer<typeof CountBucket>;

const BUCKET_LIMITS = [0, 1, 5, 10, 25, 50, 100, 250, 1000] as const;

/** A count as a coarse range, so a figure cannot single out a group by its exact size. */
export function countBucket(n: number): CountBucket {
  const value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const index = BUCKET_LIMITS.findIndex((limit) => value <= limit);
  return COUNT_BUCKETS[index === -1 ? COUNT_BUCKETS.length - 1 : index]!;
}

export const TTI_BUCKETS = ['<1s', '1-2s', '2-4s', '4-8s', '8s+'] as const;
export const TtiBucket = z.enum(TTI_BUCKETS);
export type TtiBucket = z.infer<typeof TtiBucket>;

/** Time until the app could be used, as a range. */
export function ttiBucket(ms: number): TtiBucket {
  if (!(ms >= 0) || ms < 1000) return '<1s';
  if (ms < 2000) return '1-2s';
  if (ms < 4000) return '2-4s';
  if (ms < 8000) return '4-8s';
  return '8s+';
}

export const ViewportBucket = z.enum(['phone', 'tablet', 'desktop']);
export type ViewportBucket = z.infer<typeof ViewportBucket>;

/** The same breakpoints the layout uses. */
export function viewportBucket(width: number): ViewportBucket {
  if (width < 640) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export const TelemetryPage = z.enum(['map', 'maps', 'account', 'admin', 'map_settings']);
/** Tabs of the admin page and of a map's settings. */
export const TelemetrySection = z.enum([
  'instance',
  'people',
  'plugins',
  'themes',
  'audit',
  'general',
  'labels',
  'tags',
  'bookmarks',
  'access',
  'sharing',
  'notifications',
  'discord',
  'webhooks',
  'danger',
  'backups',
]);
/** Map panels (the widget dock); `plugin` for any plugin widget. */
export const TelemetryPanel = z.enum([
  'system',
  'signatures',
  'local',
  'routes',
  'connections',
  'history',
  'plugin',
]);
export const ContextMenuAction = z.enum([
  // systems
  'status',
  'labels',
  'tags',
  'edit',
  'hidden',
  'locked',
  'copy_name',
  'remove',
  // connections
  'time',
  'mass',
  'size',
  'type',
  'bubble',
  'dangerous',
  'mass_saved',
  // either: an item a plugin added
  'plugin',
]);
export const KeyboardShortcut = z.enum(['fit_chain', 'center_on_me', 'legend']);

/**
 * Events the web app may report (through `POST /api/telemetry/e`, never straight to PostHog).
 * Each value is the exact, closed set of properties the event may carry.
 */
export const TELEMETRY_WEB_EVENTS = {
  page_viewed: z.strictObject({ page: TelemetryPage, section: TelemetrySection.optional() }),
  panel_opened: z.strictObject({ panel: TelemetryPanel }),
  context_menu_used: z.strictObject({ menu: z.enum(['system', 'connection']), action: ContextMenuAction }),
  shortcut_used: z.strictObject({ shortcut: KeyboardShortcut }),
  theme_used: z.strictObject({ theme: TelemetryThemeId, scheme: z.enum(['light', 'dark']) }),
  /** Once per page load: the kind of screen and how long until the app could be used. */
  app_loaded: z.strictObject({ viewport: ViewportBucket, tti: TtiBucket }),
} as const;

export type TelemetryWebEventName = keyof typeof TELEMETRY_WEB_EVENTS;
export type TelemetryWebEventProps<E extends TelemetryWebEventName> = z.infer<
  (typeof TELEMETRY_WEB_EVENTS)[E]
>;

export const TELEMETRY_WEB_EVENT_NAMES = Object.keys(TELEMETRY_WEB_EVENTS) as TelemetryWebEventName[];

/** Most events one ingestion request may carry. */
export const TELEMETRY_MAX_BATCH = 25;

/** Body of `POST /api/telemetry/e`. Properties are checked against the catalogue per event. */
export const TelemetryIngestRequest = z.strictObject({
  events: z
    .array(
      z.strictObject({
        event: z.string().min(1).max(40),
        props: z.record(z.string().max(40), z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(TELEMETRY_MAX_BATCH),
});
export type TelemetryIngestRequest = z.infer<typeof TelemetryIngestRequest>;

/** Why telemetry sends nothing; null while it is on. */
export const TelemetryOffReason = z.enum([
  /** No PostHog project key in this build or in TELEMETRY_POSTHOG_KEY. */
  'no_key',
  /** TELEMETRY=off. */
  'env_opt_out',
  /** DO_NOT_TRACK=1. */
  'do_not_track',
  /** Development and test servers never send. */
  'not_production',
  /** Turned off by an admin in the instance settings. */
  'admin_disabled',
]);
export type TelemetryOffReason = z.infer<typeof TelemetryOffReason>;

/** What the web app needs: whether to report at all, and whether to show the admin notice. */
export const TelemetryClientDto = z.object({
  active: z.boolean(),
  /** An admin who has not dismissed the notice about telemetry yet. */
  notice: z.boolean(),
});
export type TelemetryClientDto = z.infer<typeof TelemetryClientDto>;

export const TelemetryPayloadDto = z.object({
  /** Epoch ms when it was handed to the sender. */
  at: z.number().int(),
  event: z.string(),
  distinctId: z.string(),
  properties: z.record(z.string(), z.unknown()),
});
export type TelemetryPayloadDto = z.infer<typeof TelemetryPayloadDto>;

/** The admin Telemetry card. */
export const TelemetryStatusDto = z.object({
  active: z.boolean(),
  reason: TelemetryOffReason.nullable(),
  /** Random id of this instance; nothing else identifies it. */
  instanceId: z.string(),
  /** Where events go (the PostHog ingestion host). */
  host: z.string(),
  keyConfigured: z.boolean(),
  /** The admin switch (on unless an admin turned it off). */
  adminEnabled: z.boolean(),
  /** Events dropped by the per-minute cap since the server started. */
  dropped: z.number().int(),
  /** The last events handed to the sender, newest first. */
  recent: z.array(TelemetryPayloadDto),
  /** The daily heartbeat as it would be sent now. */
  heartbeatPreview: TelemetryPayloadDto,
});
export type TelemetryStatusDto = z.infer<typeof TelemetryStatusDto>;

export const SetTelemetryEnabledRequest = z.strictObject({ enabled: z.boolean() });
export type SetTelemetryEnabledRequest = z.infer<typeof SetTelemetryEnabledRequest>;

export const TelemetryIngestResultDto = z.object({ accepted: z.number().int() });
export type TelemetryIngestResultDto = z.infer<typeof TelemetryIngestResultDto>;

/** Where the field list and the reasoning are documented. */
export const TELEMETRY_DOCS_URL = 'https://github.com/zanreal-labs/darkbeacon/blob/main/docs/telemetry.md';
