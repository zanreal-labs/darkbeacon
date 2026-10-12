// Runs from DATA_DIR/plugins, where no packages are installed: SDK imports are types only.
import type {
  ConnectionDto,
  DiscordNotifyKind,
  DiscordNotifySettings,
  DiscordNotifyStateDto,
  DomainEvent,
  MapSystemDto,
  PingDto,
  PluginContext,
  PluginHttpRequest,
  PluginHttpResponse,
  ServerPlugin,
  UpdateDiscordNotifyRequest,
} from '@darkbeacon/plugin-sdk';
import { deliver, webhookInfo, type Fetch } from './deliver.js';
import {
  arrival,
  connectionAdded,
  connectionChanged,
  exitsFrom,
  killInChain,
  rallyPing,
  systemMarkedHostile,
  testNote,
  wayHomeDigest,
  type Embed,
  type MapView,
  type Note,
} from './describe.js';
import { KillFeed } from './kills.js';
import {
  DEFAULT_SETTINGS,
  inQuietHours,
  parseUpdate,
  RequestError,
  URGENT_KINDS,
  withDefaults,
} from './settings.js';
import { INSTANCE, Store, type MapConfig, type OutboxRow, type Target } from './store.js';

type Ports = 'maps' | 'universe' | 'db' | 'discord' | 'clock';
type Ctx = PluginContext<Ports>;

export interface DiscordNotifyOptions {
  fetch?: Fetch;
  /** Messages wait this long for others to share one post (burst batching). */
  batchMs?: number;
  /** How often the outbox is looked at. */
  tickMs?: number;
  /** Whether to read zKillboard (off in tests that do not care). */
  kills?: boolean;
}

/** At most this many embeds per Discord message. */
const EMBEDS_PER_MESSAGE = 10;
/** Retries after a failed post: 10 s, 1 min, 5 min; then the message is given up. */
const RETRIES = [10_000, 60_000, 5 * 60_000];
/** Events older than this when they are read (a plugin switched on again) are not posted. */
const STALE_MS = 10 * 60_000;
/** The way-home digest is posted at most this often. */
const DIGEST_EVERY_MS = 15 * 60_000;
/** Map data (systems, connections) is read again after this long. */
const VIEW_TTL_MS = 5_000;

const EVENTS = [
  'connection.added',
  'connection.updated',
  'connection.removed',
  'system.added',
  'system.updated',
  'system.removed',
  'ping.created',
  'character.jumped',
  'map.removed',
];

interface MapData {
  view: MapView;
  connections: ConnectionDto[];
  at: number;
}

type Flags = Pick<ConnectionDto, 'timeStatus' | 'massStatus' | 'dangerous' | 'bubbled'>;

/** The plugin; `createDiscordNotify()` is its default export, options are for tests. */
export function createDiscordNotify(options: DiscordNotifyOptions = {}): ServerPlugin<Ports> {
  let app: DiscordNotify | null = null;
  return {
    register(ctx) {
      app = new DiscordNotify(ctx, options);
      app.start();
    },
    async dispose() {
      await app?.stop();
      app = null;
    },
  };
}

export class DiscordNotify {
  private readonly store: Store;
  private readonly fetch: Fetch;
  private readonly batchMs: number;
  private readonly maps = new Map<string, MapData>();
  private readonly names = new Map<number, string>();
  private timers: NodeJS.Timeout[] = [];
  private flushing: Promise<void> | null = null;
  private kills: KillFeed | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly options: DiscordNotifyOptions,
  ) {
    this.store = new Store(ctx.ports.db, ctx.secrets);
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.batchMs = options.batchMs ?? 10_000;
  }

  private now(): number {
    return this.ctx.ports.clock.now();
  }

  private counter = 0;

  /** Outbox ids sort in the order the notes were made (the outbox is read by time, then id). */
  private nextId(): string {
    this.counter = (this.counter + 1) % 1_000_000;
    return `${this.now().toString(36).padStart(10, '0')}-${String(this.counter).padStart(6, '0')}-${crypto.randomUUID()}`;
  }

  start(): void {
    const { ctx } = this;
    ctx.consume({ name: 'events', events: EVENTS, handle: (event) => this.onEvent(event) });
    ctx.http.route({
      method: 'GET',
      path: '/maps/:mapId',
      handler: (r) => this.guard(r, () => this.state(r.params.mapId!)),
    });
    ctx.http.route({
      method: 'PUT',
      path: '/maps/:mapId',
      handler: (r) => this.guard(r, () => this.update(r.params.mapId!, r.body, r)),
    });
    ctx.http.route({
      method: 'POST',
      path: '/maps/:mapId/test',
      handler: (r) => this.guard(r, () => this.test(r.params.mapId!)),
    });
    // Notifications other plugins send through the core notifier go to the map's channel too.
    ctx.provide('notifier', {
      id: 'discord',
      send: async (n) => {
        if (!n.mapId) return;
        const config = await this.store.config(n.mapId);
        if (!config?.settings.enabled || !config.target) return;
        await this.store.enqueue([
          {
            id: this.nextId(),
            mapId: n.mapId,
            kind: 'pings',
            mention: false,
            embed: {
              title: n.title.slice(0, 256),
              description: n.body.slice(0, 4000),
              url: n.url,
              color: 0x38c6d6,
            },
            createdAt: this.now(),
          },
        ]);
      },
    });
    const every = (ms: number, work: () => Promise<unknown>) => {
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        work()
          .catch((error: unknown) => ctx.logger.error(message(error)))
          .finally(() => (busy = false));
      }, ms);
      timer.unref?.();
      this.timers.push(timer);
    };
    every(this.options.tickMs ?? 2_000, () => this.flush());
    every(60_000, () => this.digests());
    every(60 * 60_000, () => this.store.prune(this.now()));
    if (this.options.kills !== false) {
      let wanted = { value: false, at: -Infinity };
      this.kills = new KillFeed({
        fetch: this.fetch,
        now: () => this.now(),
        load: () => this.store.remember(INSTANCE, 'r2z2'),
        save: (position) => this.store.memorize(INSTANCE, 'r2z2', position),
        // Asked before every request; the answer is good for half a minute.
        wanted: async () => {
          if (this.now() - wanted.at > 30_000) {
            const value = (await this.store.activeConfigs()).some((c) => c.settings.kinds.kills);
            wanted = { value, at: this.now() };
          }
          return wanted.value;
        },
        onKill: (kill) => this.onKill(kill),
        onError: (error) => ctx.logger.warn(`zKillboard: ${message(error)}`),
      });
      this.kills.start();
    }
    ctx.logger.info('ready');
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
    await this.kills?.stop();
    await this.flushing;
  }

  // ---- HTTP ------------------------------------------------------------------------------------

  private async guard(request: PluginHttpRequest, work: () => Promise<unknown>): Promise<PluginHttpResponse> {
    if (!request.accountId) return error(401, 'unauthenticated', 'Sign in first');
    // Maps the caller cannot see are not found, as everywhere else.
    if (request.mapRole === null || request.mapRole === 'blocked')
      return error(404, 'not_found', 'Map not found');
    if (request.mapRole !== 'admin') return error(403, 'forbidden', 'Only map admins manage notifications');
    try {
      return { status: 200, body: await work() };
    } catch (failure) {
      if (failure instanceof RequestError) return error(400, 'validation', failure.message);
      throw failure;
    }
  }

  async state(mapId: string): Promise<DiscordNotifyStateDto> {
    const [config, status, pending, bot] = await Promise.all([
      this.store.config(mapId),
      this.store.status(mapId),
      this.store.pendingCount(mapId),
      this.ctx.ports.discord.available(),
    ]);
    const settings = config?.settings ?? DEFAULT_SETTINGS;
    return {
      ...settings,
      target: config?.target
        ? {
            kind: config.target.kind,
            label: config.targetLabel ?? (config.target.kind === 'webhook' ? 'Webhook' : 'Discord channel'),
            guildId: config.target.kind === 'channel' ? config.target.guildId : null,
            channelId: config.target.kind === 'channel' ? config.target.channelId : null,
          }
        : null,
      bot,
      status: {
        lastSentAt: num(status?.last_sent_at),
        lastError: status?.last_error ?? null,
        lastErrorAt: num(status?.last_error_at),
        pending,
      },
    };
  }

  async update(mapId: string, body: unknown, request?: PluginHttpRequest): Promise<DiscordNotifyStateDto> {
    const patch: UpdateDiscordNotifyRequest = parseUpdate(body);
    const saved = await this.store.config(mapId);
    const current = saved ?? {
      mapId,
      settings: DEFAULT_SETTINGS,
      target: null,
      targetLabel: null,
    };
    let target = current.target;
    let targetLabel = current.targetLabel;
    if (patch.target === null) {
      target = null;
      targetLabel = null;
    } else if (patch.target) {
      if (patch.target.kind === 'webhook') {
        const info = await webhookInfo(patch.target.url, this.fetch);
        if (!info) throw new RequestError('Discord does not know this webhook. Copy its URL again.');
        target = { kind: 'webhook', url: patch.target.url };
        targetLabel = `Webhook “${info.name}”`;
      } else {
        if (!(await this.ctx.ports.discord.available()))
          throw new RequestError('No Discord bot is connected');
        const label = await this.ctx.ports.discord.channelLabel(patch.target.guildId, patch.target.channelId);
        if (!label) throw new RequestError('The bot cannot see that channel');
        target = patch.target;
        targetLabel = label;
      }
    }
    const { target: _, ...settingsPatch } = patch;
    const settings: DiscordNotifySettings = withDefaults({ ...current.settings, ...settingsPatch });
    await this.store.saveConfig({ mapId, settings, target, targetLabel }, this.now());
    if (!target) await this.store.drop(mapId);
    if (request) {
      // The target is recorded by its label; a webhook URL only as a fingerprint.
      const audited = (c: Pick<MapConfig, 'settings' | 'target' | 'targetLabel'>) => ({
        ...c.settings,
        channel: c.targetLabel,
        webhookUrl: c.target?.kind === 'webhook' ? c.target.url : null,
      });
      await this.ctx.audit.configChanged(request, {
        mapId,
        before: saved ? audited(saved) : null,
        after: audited({ settings, target, targetLabel }),
      });
    }
    return this.state(mapId);
  }

  /** Posts one message now (no batching) and records how it went. */
  async test(mapId: string): Promise<{ ok: boolean; error: string | null }> {
    const config = await this.store.config(mapId);
    if (!config?.target) throw new RequestError('Connect a channel first');
    const data = await this.mapData(mapId);
    if (!data) throw new RequestError('Map not found');
    const result = await this.send(config.target, [testNote(data.view, this.now()).embed], null);
    if (result.ok) await this.store.saveStatus(mapId, { last_sent_at: this.now() });
    else await this.store.saveStatus(mapId, { last_error: result.error, last_error_at: this.now() });
    return { ok: result.ok, error: result.ok ? null : result.error };
  }

  // ---- Events ----------------------------------------------------------------------------------

  /** Runs in the transaction that moves the plugin's cursor: notes and memory commit together. */
  async onEvent(event: DomainEvent): Promise<void> {
    const mapId = event.stream.startsWith('map:') ? event.stream.slice(4) : null;
    if (!mapId) return;
    if (event.type === 'map.removed') {
      this.maps.delete(mapId);
      await this.store.forgetMap(mapId);
      return;
    }
    const config = await this.store.config(mapId);
    if (!config?.settings.enabled || !config.target) return;
    this.maps.delete(mapId); // the map changed: read it again
    const data = await this.mapData(mapId);
    if (!data) return;
    const notes = await this.describe(event, data, config);
    if (this.now() - event.occurredAt > STALE_MS) return;
    await this.enqueue(config, notes, event.occurredAt);
  }

  private async describe(event: DomainEvent, data: MapData, config: MapConfig): Promise<Note[]> {
    const { view } = data;
    const mapId = view.map.id;
    const at = event.occurredAt;
    switch (event.type) {
      case 'connection.added': {
        const c = event.data as ConnectionDto;
        await this.store.memorize(mapId, `c:${c.id}`, flags(c));
        await this.markDigest(config);
        return [connectionAdded(view, c, at)];
      }
      case 'connection.updated': {
        const c = event.data as ConnectionDto;
        const before = await this.store.remember<Flags>(mapId, `c:${c.id}`);
        await this.store.memorize(mapId, `c:${c.id}`, flags(c));
        return connectionChanged(view, before, c, at);
      }
      case 'connection.removed':
        await this.store.forget(mapId, `c:${(event.data as { id: string }).id}`);
        await this.markDigest(config);
        return [];
      case 'system.added':
      case 'system.updated': {
        const s = event.data as MapSystemDto;
        const before = await this.store.remember<string>(mapId, `s:${s.solarSystemId}`);
        await this.store.memorize(mapId, `s:${s.solarSystemId}`, s.status);
        if (before !== s.status) await this.markDigest(config);
        return s.status === 'hostile' && before !== 'hostile' && event.type === 'system.updated'
          ? [systemMarkedHostile(view, s, at)]
          : [];
      }
      case 'system.removed':
        await this.markDigest(config);
        return [];
      case 'ping.created':
        return [rallyPing(view, event.data as PingDto, at)];
      case 'character.jumped': {
        const jump = event.data as { characterId: number; from: number; to: number };
        const inChain = (id: number) => view.systems.get(id)?.visible === true;
        if (!inChain(jump.to) || inChain(jump.from)) return [];
        const name = (await this.characterNames([jump.characterId])).get(jump.characterId) ?? 'A pilot';
        return [arrival(view, name, jump.to, at)];
      }
      default:
        return [];
    }
  }

  /** Stores the notes the map wants; quiet hours let only urgent ones through, without mentions. */
  private async enqueue(config: MapConfig, notes: readonly Note[], at: number): Promise<void> {
    const { settings } = config;
    const quiet = inQuietHours(settings.quietHours, at);
    const wanted = notes.filter(
      (n) => settings.kinds[n.kind] && (!quiet || (URGENT_KINDS as readonly string[]).includes(n.kind)),
    );
    await this.store.enqueue(
      wanted.map((n) => ({
        id: this.nextId(),
        mapId: config.mapId,
        kind: n.kind,
        mention:
          !quiet &&
          settings.mention.kind !== 'none' &&
          (settings.mention.kinds as readonly DiscordNotifyKind[]).includes(n.kind),
        embed: n.embed,
        createdAt: this.now(),
      })),
    );
  }

  private async markDigest(config: MapConfig): Promise<void> {
    if (config.settings.kinds.wayHome) await this.store.memorize(config.mapId, 'digest:dirty', true);
  }

  // ---- Sending ---------------------------------------------------------------------------------

  /** Posts every batch that is due: older than the batch window, or a full message. */
  flush(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    const now = this.now();
    const rows = await this.store.pending(now);
    const byMap = new Map<string, OutboxRow[]>();
    for (const row of rows) byMap.set(row.mapId, [...(byMap.get(row.mapId) ?? []), row]);
    for (const [mapId, list] of byMap) {
      const fresh = list.every((r) => r.attempts === 0 && now - r.createdAt < this.batchMs);
      if (fresh && list.length < EMBEDS_PER_MESSAGE) continue;
      const config = await this.store.config(mapId);
      if (!config?.settings.enabled || !config.target) {
        await this.store.drop(mapId);
        continue;
      }
      for (let i = 0; i < list.length; i += EMBEDS_PER_MESSAGE) {
        await this.post(config, list.slice(i, i + EMBEDS_PER_MESSAGE));
      }
    }
  }

  private async post(config: MapConfig, rows: OutboxRow[]): Promise<void> {
    const mention = rows.some((r) => r.mention) && !inQuietHours(config.settings.quietHours, this.now());
    const result = await this.send(
      config.target!,
      rows.map((r) => r.embed),
      mention ? config.settings.mention : null,
    );
    const ids = rows.map((r) => r.id);
    this.ctx.metrics.delivery('discord', result.ok ? 'ok' : 'failed');
    if (result.ok) {
      await this.store.markSent(ids, config.mapId, this.now());
    } else if (result.retryAfterMs !== undefined) {
      await this.store.postpone(ids, this.now() + result.retryAfterMs);
    } else {
      await this.store.markFailed(rows, config.mapId, result.error, this.now(), (row) =>
        result.permanent ? null : row.attempts < RETRIES.length ? this.now() + RETRIES[row.attempts]! : null,
      );
    }
  }

  private async send(
    target: Target,
    embeds: Embed[],
    mention: DiscordNotifySettings['mention'] | null,
  ): Promise<Awaited<ReturnType<typeof deliver>>> {
    const settings = await this.ctx.settings
      .get<{ username?: string }>()
      .catch(() => ({}) as { username?: string });
    return deliver(
      target,
      { embeds, mention },
      { fetch: this.fetch, bot: this.ctx.ports.discord, username: settings.username ?? 'Darkbeacon' },
    );
  }

  // ---- Way home and kills ----------------------------------------------------------------------

  /** Posts the way-home digest of maps whose exits changed, at most every 15 minutes. */
  async digests(): Promise<void> {
    for (const config of await this.store.activeConfigs()) {
      if (!config.settings.kinds.wayHome) continue;
      if (!(await this.store.remember<boolean>(config.mapId, 'digest:dirty'))) continue;
      const last = await this.store.remember<{ at: number; exits: string }>(config.mapId, 'digest:last');
      if (last && this.now() - last.at < DIGEST_EVERY_MS) continue;
      await this.store.forget(config.mapId, 'digest:dirty');
      const data = await this.mapData(config.mapId);
      if (!data) continue;
      const home = [...data.view.systems.values()].find((s) => s.visible && s.status === 'home');
      if (!home) continue;
      const visible = new Set(
        [...data.view.systems.values()].filter((s) => s.visible).map((s) => s.solarSystemId),
      );
      const exits = exitsFrom(
        home.solarSystemId,
        data.connections,
        visible,
        (id) => data.view.universe(id)?.whClass,
      );
      const key = JSON.stringify(exits);
      if (last?.exits === key) continue;
      await this.store.memorize(config.mapId, 'digest:last', { at: this.now(), exits: key });
      await this.enqueue(
        config,
        [wayHomeDigest(data.view, home.solarSystemId, exits, this.now())],
        this.now(),
      );
    }
  }

  private async onKill(
    kill: Parameters<typeof killInChain>[1] & { victimId: number | null; shipTypeId: number | null },
  ) {
    if (this.now() - kill.time > STALE_MS) return;
    for (const config of await this.store.activeConfigs()) {
      if (!config.settings.kinds.kills) continue;
      const data = await this.mapData(config.mapId, 60_000);
      if (data?.view.systems.get(kill.systemId)?.visible !== true) continue;
      const names = await this.characterNames(
        [kill.victimId, kill.shipTypeId].filter((id): id is number => id !== null),
      );
      const note = killInChain(data.view, {
        ...kill,
        victim: kill.victimId ? (names.get(kill.victimId) ?? null) : null,
        ship: kill.shipTypeId ? (names.get(kill.shipTypeId) ?? null) : null,
      });
      await this.enqueue(config, [note], kill.time);
    }
  }

  // ---- Lookups ---------------------------------------------------------------------------------

  private async mapData(mapId: string, ttl = VIEW_TTL_MS): Promise<MapData | null> {
    const cached = this.maps.get(mapId);
    if (cached && this.now() - cached.at < ttl) return cached;
    const { maps, universe } = this.ctx.ports;
    const map = await maps.getMap(mapId);
    if (!map) return null;
    const [systems, connections] = await Promise.all([maps.listSystems(mapId), maps.listConnections(mapId)]);
    const data: MapData = {
      view: {
        map,
        systems: new Map(systems.map((s) => [s.solarSystemId, s])),
        universe: (id) => {
          try {
            return universe.getSystem(id);
          } catch {
            return null;
          }
        },
        publicUrl: this.ctx.instance.publicUrl,
      },
      connections,
      at: this.now(),
    };
    this.maps.set(mapId, data);
    return data;
  }

  /** Names of characters and ship types from ESI (`POST /universe/names`), remembered. */
  private async characterNames(ids: readonly number[]): Promise<Map<number, string>> {
    const missing = [...new Set(ids)].filter((id) => !this.names.has(id));
    if (missing.length > 0) {
      try {
        const response = await this.fetch('https://esi.evetech.net/universe/names', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-compatibility-date': '2020-01-01',
            'user-agent': 'Darkbeacon',
          },
          body: JSON.stringify(missing),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          for (const e of (await response.json()) as Array<{ id: number; name: string }>)
            this.names.set(e.id, e.name);
        }
      } catch {
        // Names are a nicety; the message goes out without them.
      }
    }
    return new Map(ids.flatMap((id) => (this.names.has(id) ? [[id, this.names.get(id)!] as const] : [])));
  }
}

function flags(c: ConnectionDto): Flags {
  return { timeStatus: c.timeStatus, massStatus: c.massStatus, dangerous: c.dangerous, bubbled: c.bubbled };
}

function num(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function error(status: number, code: string, text: string): PluginHttpResponse {
  return { status, body: { error: { code, message: text } } };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const plugin: ServerPlugin<Ports> = createDiscordNotify();
export default plugin;
