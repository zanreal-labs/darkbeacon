import { z } from 'zod';
import {
  AccessSubjectKind,
  ConnectionType,
  CountBucket,
  EveEntityCategory,
  FIRST_PARTY_PLUGIN_IDS,
  FirstPartyPluginId,
  JumpHull,
  RouteMode,
  TELEMETRY_WEB_EVENTS,
  TelemetryThemeId,
} from '@darkbeacon/shared';
import { MAX_TELEMETRY_NUMBER, piiProblem } from './pii.js';

/** How a change was made: in the web app, by auto-mapping, over an API token or by a plugin. */
export const ChangeSource = z.enum(['manual', 'auto', 'api', 'plugin']);
export type ChangeSource = z.infer<typeof ChangeSource>;

/** A connection field someone set (`eol`: the time status set to end of life). */
export const ConnectionField = z.enum([
  'type',
  'time',
  'eol',
  'mass',
  'size',
  'bubble',
  'dangerous',
  'mass_saved',
]);
export type ConnectionField = z.infer<typeof ConnectionField>;

/** A first-party plugin by id; any other plugin only as `third_party`. */
export const PluginRef = z.union([FirstPartyPluginId, z.literal('third_party')]);

export function pluginRef(id: string): z.infer<typeof PluginRef> {
  return (FIRST_PARTY_PLUGIN_IDS as readonly string[]).includes(id)
    ? (id as z.infer<typeof FirstPartyPluginId>)
    : 'third_party';
}

const Count = z.number().int().min(0).max(MAX_TELEMETRY_NUMBER);

/** The daily instance heartbeat: configuration and sizes, never what is on a map. */
export const HeartbeatProps = z.strictObject({
  db: z.enum(['sqlite', 'postgres']),
  node_major: z.number().int().min(0).max(999),
  /** Discord sign-in is configured (DISCORD_CLIENT_ID/SECRET). */
  discord_login: z.boolean(),
  /** EVE SSO is configured (EVE_CLIENT_ID/SECRET). */
  eve_sso: z.boolean(),
  /** The effective sign-in method; `eve` is the EVE-only mode. */
  login_method: z.enum(['discord', 'eve']),
  discord_bot: z.boolean(),
  plugins_first_party: z.array(FirstPartyPluginId).max(FIRST_PARTY_PLUGIN_IDS.length),
  plugins_third_party: CountBucket,
  theme_default: TelemetryThemeId,
  themes_third_party: CountBucket,
  event_retention: z.boolean(),
  accounts: Count,
  characters: Count,
  maps: Count,
  accounts_dau: Count,
  accounts_wau: Count,
  accounts_mau: Count,
  characters_dau: Count,
  characters_wau: Count,
  characters_mau: Count,
  /** Most tracked characters online at once since the last heartbeat. */
  online_peak: Count,
  systems: CountBucket,
  connections: CountBucket,
  signatures: CountBucket,
  webhooks: CountBucket,
  discord_notify_maps: CountBucket,
});
export type HeartbeatProps = z.infer<typeof HeartbeatProps>;

const none = z.strictObject({});

/** Events the server reports, mostly derived from domain events (see `featureEvents`). */
export const TELEMETRY_SERVER_EVENTS = {
  instance_heartbeat: HeartbeatProps,
  map_created: none,
  system_added: z.strictObject({ source: ChangeSource }),
  connection_added: z.strictObject({ type: ConnectionType, source: ChangeSource }),
  connection_updated: z.strictObject({ field: ConnectionField, source: ChangeSource }),
  labels_changed: none,
  system_labels_changed: none,
  ping_created: none,
  access_rule_added: z.strictObject({ subject: AccessSubjectKind }),
  webhook_created: none,
  history_reverted: none,
  plugin_enabled: z.strictObject({ plugin: PluginRef }),
  plugin_disabled: z.strictObject({ plugin: PluginRef }),
  signed_in: z.strictObject({ method: z.enum(['discord', 'eve', 'demo', 'dev']) }),
  signatures_pasted: z.strictObject({ added: CountBucket, updated: CountBucket, removed: CountBucket }),
  route_computed: z.strictObject({ mode: RouteMode, skips: z.boolean(), avoids: z.boolean() }),
  bookmark_template_changed: z.strictObject({ scope: z.enum(['map', 'personal']) }),
  esi_picker_used: z.strictObject({ category: EveEntityCategory, mode: z.enum(['search', 'exact']) }),
  waypoint_set: z.strictObject({ mode: z.enum(['destination', 'waypoint']) }),
  /** A jump route was planned: the hull class and how many legs it has (a bucket; 0 = no route). */
  jump_planned: z.strictObject({ hull: JumpHull, legs: CountBucket }),
} as const;

export type TelemetryServerEventName = keyof typeof TELEMETRY_SERVER_EVENTS;
export type TelemetryServerEventProps<E extends TelemetryServerEventName> = z.infer<
  (typeof TELEMETRY_SERVER_EVENTS)[E]
>;

/** Every event an instance may send, with its exact properties. */
export const TELEMETRY_CATALOGUE: Readonly<Record<string, z.ZodType>> = {
  ...TELEMETRY_SERVER_EVENTS,
  ...TELEMETRY_WEB_EVENTS,
};

export type TelemetryValidation =
  { ok: true; props: Record<string, unknown> } | { ok: false; problem: string };

/** Checks one event against the allow-list: a known name, exactly its properties, no PII shapes. */
export function validateTelemetryEvent(
  name: string,
  props: unknown,
  catalogue: Readonly<Record<string, z.ZodType>> = TELEMETRY_CATALOGUE,
): TelemetryValidation {
  if (!Object.hasOwn(catalogue, name)) return { ok: false, problem: `unknown event ${name}` };
  const parsed = catalogue[name]!.safeParse(props ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problem: `${name}: ${issue?.path.join('.') || 'props'} ${issue?.message ?? 'invalid'}`,
    };
  }
  const value = parsed.data as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    const problem = piiProblem(item, `${name}.${key}`);
    if (problem) return { ok: false, problem };
  }
  return { ok: true, props: value };
}
