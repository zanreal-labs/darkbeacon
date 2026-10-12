import type { Clock, DomainEvent, MapRole } from '@darkbeacon/core';
import type { Kysely } from 'kysely';
import type { ConnectionDto, MapDto, MapSystemDto, UniverseSystemDto } from '@darkbeacon/shared';
import type { PluginPortName } from './manifest.js';

/** Read access to maps the plugin is enabled on. */
export interface MapReader {
  getMap(mapId: string): Promise<MapDto | null>;
  listSystems(mapId: string): Promise<MapSystemDto[]>;
  listConnections(mapId: string): Promise<ConnectionDto[]>;
}

export interface UniverseReader {
  getSystem(solarSystemId: number): UniverseSystemDto | null;
  searchSystems(query: string, limit?: number): UniverseSystemDto[];
}

export interface EventReader {
  readSince(stream: string, sinceSeq: number, limit?: number): Promise<DomainEvent[]>;
}

/** Someone on a map, as plugins see them: no cursors, selections or drags. */
export interface PresenceSummary {
  accountId: string;
  name: string;
  characterId: number | null;
  characterName: string | null;
  /** What they have open for editing, if anything. */
  editing: { kind: 'system' | 'connection' | 'signature' | 'map'; id: string; field?: string } | null;
  /** When they arrived on the map (epoch ms). */
  since: number;
}

/**
 * Who is on the maps the plugin is enabled on (one entry per open tab). Presence is never
 * stored, so this is only ever the current moment.
 */
export interface PresenceReader {
  here(mapId: string): Promise<PresenceSummary[]>;
  /**
   * Called when someone arrives, leaves or opens something for editing on a map (at most a few
   * times a second per map). Returns an unsubscribe function; unloading the plugin unsubscribes.
   */
  onChange(handler: (mapId: string, here: PresenceSummary[]) => void): () => void;
}

export interface Notification {
  mapId: string | null;
  title: string;
  body: string;
  url?: string;
  event?: DomainEvent;
}

/** A delivery channel (Discord, Slack...). Plugins may also provide one. */
export interface Notifier {
  readonly id: string;
  send(notification: Notification): Promise<void>;
}

/**
 * The instance database, for the plugin's own tables (created by its migrations and named
 * `<plugin_id>_<table>`, dashes as underscores). Core tables are not part of the contract.
 *
 * This is a trusted port: the handle reaches every table, and writes to core tables bypass
 * authorization and events. The admin panel says so before a plugin asking for it is enabled.
 */
export interface PluginDatabase {
  readonly dialect: 'sqlite' | 'postgres';
  /** Query builder bound to the open transaction inside `transaction()`. Always query through it. */
  db<T>(): Kysely<T>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/** A file in the manifest's `migrations` folder (`0001_create.js`) exports this. */
export interface PluginMigration {
  up(db: Kysely<unknown>): Promise<void>;
}

/**
 * The instance's Discord bot, when an admin connected one (Admin, Instance). Messages take
 * Discord's Create Message shape (`content`, `embeds`, `allowed_mentions`).
 */
export interface DiscordBotPort {
  /** True when a bot is connected. */
  available(): Promise<boolean>;
  /** "#alerts on Hard Knocks", or null when the bot cannot see that channel. */
  channelLabel(guildId: string, channelId: string): Promise<string | null>;
  /** Posts as the bot; rejects with Discord's reason. */
  send(channelId: string, message: Record<string, unknown>): Promise<void>;
}

export interface PluginPorts {
  maps: MapReader;
  universe: UniverseReader;
  events: EventReader;
  notifier: Notifier;
  clock: Clock;
  db: PluginDatabase;
  presence: PresenceReader;
  discord: DiscordBotPort;
}

/**
 * A durable subscription: events are read from the event log with a cursor kept for the plugin,
 * so nothing is missed across restarts or while the plugin reloads. `handle` runs inside the
 * transaction that moves the cursor (writes through the `db` port commit with it); a handler
 * that throws is retried, and after five failures the event is skipped. Events from while the
 * plugin was switched off are delivered when it is switched on again: check `occurredAt`.
 */
export interface DurableConsumer {
  /** Stable within the plugin; the cursor is stored under it. */
  name: string;
  /** Event types or `prefix.*`, covered by the manifest's `events`. Map events only. */
  events: string[];
  handle(event: DomainEvent): Promise<void>;
}

/** Ports a plugin can implement for the core. */
export interface ProvidablePorts {
  notifier: Notifier;
}

export interface PluginLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface PluginSettings {
  /** Instance-level settings, validated against the manifest's settings schema. */
  get<T = Record<string, unknown>>(): Promise<T>;
  /** Settings for one map (falls back to instance settings). */
  forMap<T = Record<string, unknown>>(mapId: string): Promise<T>;
}

export interface PluginHttpRequest {
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Null when the caller is not signed in. */
  accountId: string | null;
  /**
   * For routes with a `:mapId` parameter: the caller's role on that map, null when the caller
   * has none or is not signed in. Check it before serving map data (at least `viewer`).
   * Such routes are not reached at all on maps the plugin is switched off on.
   */
  mapRole: MapRole | null;
}

export interface PluginHttpResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative to `/api/plugins/<id>`, e.g. `/status`. */
  path: string;
  handler(request: PluginHttpRequest): Promise<PluginHttpResponse> | PluginHttpResponse;
}

/**
 * A change a plugin route made to the plugin's own configuration (kept in its own tables), for the
 * instance audit trail. Values of secret-looking keys (tokens, webhook URLs, passwords) are
 * replaced by a short fingerprint before they are stored.
 */
export interface PluginConfigChange {
  /** The map the configuration belongs to; null for instance-wide configuration. */
  mapId: string | null;
  /** The configuration before the change; null when there was none. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

/** Core commands a plugin may run; the core authorizes them as the plugin actor. */
export interface PluginCommands {
  run(name: string, input: unknown): Promise<unknown>;
}

/** Instance metrics a plugin may add to; attributes are fixed so they stay low-cardinality. */
export interface PluginMetrics {
  /**
   * One notification delivered to an outside service, or a failed attempt. `channel` is a short
   * name such as `discord` (lower case letters, digits, `-` and `_`).
   */
  delivery(channel: string, outcome: 'ok' | 'failed'): void;
}

export interface PluginContext<P extends PluginPortName = PluginPortName> {
  readonly plugin: { id: string; version: string };
  /** Only the ports declared in the manifest. */
  readonly ports: Pick<PluginPorts, P>;
  /**
   * Subscribes to committed events (exact type or `prefix.*`), which must be covered by the
   * manifest's `events`. Map events arrive only from maps the plugin is enabled on.
   * Returns an unsubscribe function.
   */
  on(eventType: string, handler: (event: DomainEvent) => void | Promise<void>): () => void;
  /** Like `on`, but durable (see `DurableConsumer`). Returns a function that stops it. */
  consume(consumer: DurableConsumer): () => void;
  /** Facts about the instance the plugin runs on. */
  readonly instance: { readonly publicUrl: string };
  /**
   * Encrypts secrets (webhook URLs, tokens) for the plugin's own tables, with a key derived from
   * the instance's SECRET_KEY for this plugin alone. `open` answers null for text it cannot open.
   */
  readonly secrets: { seal(text: string): string; open(sealed: string): string | null };
  readonly commands: PluginCommands;
  readonly settings: PluginSettings;
  readonly logger: PluginLogger;
  /** Measurements the instance exports when its operator turns telemetry on (free otherwise). */
  readonly metrics: PluginMetrics;
  readonly http: { route(route: PluginRoute): void };
  /**
   * Records who changed the plugin's configuration through one of its routes. Pass the request
   * the route was called with: the person behind it is taken from there, never from the plugin.
   */
  readonly audit: { configChanged(request: PluginHttpRequest, change: PluginConfigChange): Promise<void> };
  /** Offers an adapter to the core, e.g. a Notifier that every `notifier.send` reaches. */
  provide<K extends keyof ProvidablePorts>(port: K, adapter: ProvidablePorts[K]): void;
}

export interface ServerPlugin<P extends PluginPortName = PluginPortName> {
  register(ctx: PluginContext<P>): void | Promise<void>;
  /** Called on disable/unload; release timers and connections here. */
  dispose?(): void | Promise<void>;
}

/** Default export of a plugin's server entry. */
export function definePlugin<P extends PluginPortName = PluginPortName>(
  plugin: ServerPlugin<P>,
): ServerPlugin<P> {
  return plugin;
}
