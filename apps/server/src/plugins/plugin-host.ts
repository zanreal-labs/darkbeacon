import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger } from '@nestjs/common';
import {
  ForbiddenError,
  INSTANCE_STREAM,
  parseStream,
  type Actor,
  type Clock,
  type DomainEvent,
  type EventBus,
  type EventLog,
  type MapAccess,
} from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import type { NotifierRegistry } from '@darkbeacon/notifications';
import {
  MANIFEST_FILE,
  eventAllowed,
  parseManifest,
  type MapReader,
  type Notification,
  type Notifier,
  type PluginContext,
  type PluginHttpRequest,
  type PluginHttpResponse,
  type PluginLogger,
  type PluginManifest,
  type PluginPorts,
  type PluginRoute,
  type ServerPlugin,
  type UniverseReader,
} from '@darkbeacon/plugin-sdk';
import {
  isActiveOn,
  pluginRevision,
  settingsFor,
  type InstalledPlugin,
  type PluginAdmin,
  type PluginRepository,
  type PluginSettingsSchemas,
  type PluginSettingsValues,
} from '@darkbeacon/plugins';
import type { MapSnapshot } from '@darkbeacon/shared';
import { readJson } from './installer.js';
import { manifestPath } from './manifest-file.js';
import type { PluginCommandRegistry } from './plugin-commands.js';
import { runPluginMigrations } from './plugin-migrations.js';

/**
 * Port implementations other modules contribute after startup: the mapping module sets
 * `universe`, and `mapSnapshot` reads a map the way the realtime snapshot does.
 */
export class PluginPortProviders {
  universe: UniverseReader | null = null;
  mapSnapshot: ((mapId: string) => Promise<MapSnapshot | null>) | null = null;
}

export interface PluginHostDeps {
  admin: Pick<PluginAdmin, 'disableFailing'>;
  plugins: PluginRepository;
  schemas: PluginSettingsSchemas;
  database: Database;
  /** Answers the caller's role for plugin routes with a `:mapId` parameter. */
  access: MapAccess;
  bus: EventBus;
  log: EventLog;
  clock: Clock;
  notifiers: NotifierRegistry;
  commands: PluginCommandRegistry;
  providers: PluginPortProviders;
  pluginDir(id: string): string;
  logger?: (pluginId: string) => PluginLogger;
  /** Failures in a row (handlers, routes, notifiers) after which a plugin is disabled. Default 5. */
  failureThreshold?: number;
  /** How long `register()` may take. Default 30 s. */
  registerTimeoutMs?: number;
}

interface CompiledRoute {
  route: PluginRoute;
  pattern: RegExp;
  params: string[];
}

interface LoadedPlugin {
  plugin: InstalledPlugin;
  revision: string;
  manifest: PluginManifest;
  instance: ServerPlugin | null;
  routes: CompiledRoute[];
  cleanups: Array<() => void>;
  failures: number;
  logger: PluginLogger;
  stopped: boolean;
}

const PROVIDABLE = new Set(['notifier']);

/**
 * Loads enabled plugins natively into this process and keeps them in step with the registry.
 * Everything a plugin does runs behind a catch: failures are counted, and a plugin that keeps
 * failing is unloaded and disabled with the reason, which the admin panel shows.
 */
export class PluginHost {
  private readonly loaded = new Map<string, LoadedPlugin>();
  /** Serializes load/unload so overlapping syncs of one plugin cannot interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly threshold: number;

  constructor(private readonly deps: PluginHostDeps) {
    this.threshold = deps.failureThreshold ?? 5;
  }

  /** Loads every enabled plugin. A broken plugin is disabled; it never stops the server. */
  start(): Promise<void> {
    return this.serial(async () => {
      for (const plugin of await this.deps.plugins.list()) {
        if (plugin.enabled) await this.load(plugin);
      }
    });
  }

  stop(): Promise<void> {
    return this.serial(async () => {
      for (const id of [...this.loaded.keys()]) await this.unload(id);
    });
  }

  /**
   * Brings one plugin in line with the registry: loads, unloads, or reloads it when a new
   * revision was installed. Per-map switches apply without a reload.
   */
  sync(id: string): Promise<void> {
    return this.serial(async () => {
      const plugin = await this.deps.plugins.findById(id);
      const current = this.loaded.get(id);
      if (!plugin?.enabled) {
        if (current) await this.unload(id);
        return;
      }
      if (current && current.revision === pluginRevision(plugin)) {
        current.plugin = plugin;
        return;
      }
      if (current) await this.unload(id);
      await this.load(plugin);
    });
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  /**
   * Runs a plugin's route for `<method> /api/plugins/<id><path>`; null when none matches. A route
   * with a `:mapId` parameter does not match on maps the plugin is switched off on, and gets the
   * caller's role on the map.
   */
  async handleHttp(
    id: string,
    method: string,
    path: string,
    caller: Actor | null,
    request: Pick<PluginHttpRequest, 'query' | 'body'>,
  ): Promise<PluginHttpResponse | null> {
    const loaded = this.loaded.get(id);
    if (!loaded) return null;
    for (const compiled of loaded.routes) {
      if (compiled.route.method !== method) continue;
      const match = compiled.pattern.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(compiled.params.map((name, i) => [name, decode(match[i + 1]!)]));
      const mapId = params.mapId;
      if (mapId !== undefined && !isActiveOn(loaded.plugin, mapId)) return null;
      try {
        const mapRole = mapId !== undefined && caller ? await this.deps.access.roleOf(caller, mapId) : null;
        const accountId = caller?.kind === 'account' ? caller.id : null;
        const response = await compiled.route.handler({ ...request, method, params, accountId, mapRole });
        loaded.failures = 0;
        return response;
      } catch (error) {
        this.fail(loaded, error, `${method} ${path}`);
        return { status: 500, body: { error: { code: 'internal', message: 'The plugin failed' } } };
      }
    }
    return null;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(plugin: InstalledPlugin): Promise<void> {
    const dir = this.deps.pluginDir(plugin.id);
    const logger = this.deps.logger?.(plugin.id) ?? nestLogger(plugin.id);
    const file = manifestPath(dir, 'plugin');
    const parsed = parseManifest(file ? await readJson(file).catch(() => null) : null);
    if (!parsed.ok) {
      await this.disable(plugin.id, `Invalid manifest: ${parsed.errors.join('; ')}`, 1, logger);
      return;
    }
    const loaded: LoadedPlugin = {
      plugin,
      revision: pluginRevision(plugin),
      manifest: parsed.manifest,
      instance: null,
      routes: [],
      cleanups: [],
      failures: 0,
      logger,
      stopped: false,
    };
    this.loaded.set(plugin.id, loaded);
    try {
      const { migrations, server, ports } = parsed.manifest;
      // parseManifest refuses migrations without the db port; checked again as it hands out the database.
      if (migrations && ports.includes('db')) {
        const applied = await runPluginMigrations(this.deps.database, plugin.id, join(dir, migrations), () =>
          this.deps.clock.now(),
        );
        if (applied.length > 0) logger.info(`applied migrations: ${applied.join(', ')}`);
      }
      if (server) {
        // The revision in the URL makes Node load the new code after an upgrade.
        const url = `${pathToFileURL(join(dir, server)).href}?rev=${encodeURIComponent(loaded.revision)}`;
        const module = (await import(/* @vite-ignore */ url)) as { default?: unknown };
        const instance = (module.default ?? module) as Partial<ServerPlugin>;
        if (typeof instance.register !== 'function') throw new Error(`${server} has no register() export`);
        loaded.instance = instance as ServerPlugin;
        await withTimeout(
          Promise.resolve(loaded.instance.register(this.context(loaded))),
          this.deps.registerTimeoutMs ?? 30_000,
          'register() did not finish in time',
        );
      }
      logger.info(`loaded ${plugin.manifest.version}`);
    } catch (error) {
      await this.unload(plugin.id);
      await this.disable(plugin.id, `Failed to start: ${message(error)}`, 1, logger);
    }
  }

  private async unload(id: string): Promise<void> {
    const loaded = this.loaded.get(id);
    if (!loaded) return;
    this.loaded.delete(id);
    loaded.stopped = true;
    for (const cleanup of loaded.cleanups) cleanup();
    try {
      await loaded.instance?.dispose?.();
    } catch (error) {
      loaded.logger.warn(`dispose failed: ${message(error)}`);
    }
  }

  /** Counts a failure; at the threshold the plugin is unloaded and disabled. Never throws. */
  private fail(loaded: LoadedPlugin, error: unknown, where: string): void {
    if (loaded.stopped) return;
    loaded.failures += 1;
    loaded.logger.error(`${where} failed (${loaded.failures}/${this.threshold}): ${message(error)}`);
    if (loaded.failures < this.threshold) return;
    loaded.stopped = true;
    const reason = `Disabled after ${loaded.failures} failures in a row; last: ${where}: ${message(error)}`;
    void this.serial(async () => {
      if (this.loaded.get(loaded.plugin.id) === loaded) await this.unload(loaded.plugin.id);
      await this.disable(loaded.plugin.id, reason, loaded.failures, loaded.logger);
    });
  }

  private async disable(id: string, reason: string, failures: number, logger: PluginLogger): Promise<void> {
    logger.error(reason);
    try {
      await this.deps.admin.disableFailing(id, reason, failures);
    } catch (error) {
      logger.error(`could not record the failure: ${message(error)}`);
    }
  }

  private context(loaded: LoadedPlugin): PluginContext {
    const { id } = loaded.plugin;
    const actor: Actor = { kind: 'plugin', id };
    const factories = this.portFactories(loaded);
    // Only the ports the manifest asks for exist on ctx.ports.
    const ports = Object.freeze(
      Object.fromEntries(loaded.manifest.ports.map((name) => [name, factories[name]()])),
    ) as PluginContext['ports'];
    return Object.freeze({
      plugin: Object.freeze({ id, version: loaded.manifest.version }),
      ports,
      on: (type: string, handler: (event: DomainEvent) => void | Promise<void>) =>
        this.subscribe(loaded, type, handler),
      commands: { run: (name: string, input: unknown) => this.deps.commands.run(actor, name, input) },
      settings: {
        get: <T>() => this.settings(id, null) as Promise<T>,
        forMap: <T>(mapId: string) => this.settings(id, mapId) as Promise<T>,
      },
      logger: loaded.logger,
      http: { route: (route: PluginRoute) => this.addRoute(loaded, route) },
      provide: (port: string, adapter: Notifier) => this.provide(loaded, port, adapter),
    });
  }

  private portFactories(loaded: LoadedPlugin): { [K in keyof PluginPorts]: () => PluginPorts[K] } {
    const { database, log, notifiers, clock, providers } = this.deps;
    const universe = (): UniverseReader => {
      if (!providers.universe) throw new Error('No universe data on this server');
      return providers.universe;
    };
    return {
      maps: () => this.mapReader(loaded),
      universe: () => ({
        getSystem: (systemId) => universe().getSystem(systemId),
        searchSystems: (query, limit) => universe().searchSystems(query, limit),
      }),
      events: () => ({
        readSince: (stream, sinceSeq, limit) => {
          this.requireStream(loaded, stream);
          return log.readSince(stream, sinceSeq, limit);
        },
      }),
      notifier: () => ({ id: 'core', send: (n) => notifiers.send(n) }),
      clock: () => clock,
      db: () => ({
        dialect: database.dialect,
        db: () => database.db(),
        transaction: (work) => database.transaction(work),
      }),
    };
  }

  private mapReader(loaded: LoadedPlugin): MapReader {
    const snapshot = async (mapId: string): Promise<MapSnapshot | null> => {
      const read = this.deps.providers.mapSnapshot;
      if (!isActiveOn(loaded.plugin, mapId) || !read) return null;
      return read(mapId);
    };
    return {
      getMap: async (mapId) => (await snapshot(mapId))?.map ?? null,
      listSystems: async (mapId) => (await snapshot(mapId))?.systems ?? [],
      listConnections: async (mapId) => (await snapshot(mapId))?.connections ?? [],
    };
  }

  private requireStream(loaded: LoadedPlugin, stream: string): void {
    const parsed = parseStream(stream);
    const ok = stream === INSTANCE_STREAM || (parsed?.kind === 'map' && isActiveOn(loaded.plugin, parsed.id));
    if (!ok) throw new ForbiddenError(`Plugin ${loaded.plugin.id} may not read ${stream}`);
  }

  private subscribe(
    loaded: LoadedPlugin,
    type: string,
    handler: (event: DomainEvent) => void | Promise<void>,
  ): () => void {
    if (!eventAllowed(loaded.manifest.events, type)) {
      throw new ForbiddenError(`"${type}" is not among the events in ${MANIFEST_FILE}`);
    }
    const unsubscribe = this.deps.bus.subscribe(
      async (event) => {
        if (loaded.stopped || !isActiveOn(loaded.plugin, mapIdOf(event))) return;
        try {
          await handler(event);
          loaded.failures = 0;
        } catch (error) {
          this.fail(loaded, error, `handling ${event.type}`);
        }
      },
      { types: [type] },
    );
    loaded.cleanups.push(unsubscribe);
    return unsubscribe;
  }

  private addRoute(loaded: LoadedPlugin, route: PluginRoute): void {
    if (!/^\/[A-Za-z0-9._~:/-]*$/.test(route.path) || route.path.startsWith('/assets/')) {
      throw new Error(`invalid route path ${route.path}`);
    }
    const params: string[] = [];
    const source = route.path
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        params.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    loaded.routes.push({ route, pattern: new RegExp(`^${source}/?$`), params });
  }

  private provide(loaded: LoadedPlugin, port: string, adapter: Notifier): void {
    if (!PROVIDABLE.has(port)) throw new Error(`plugins cannot provide "${port}"`);
    const remove = this.deps.notifiers.add({
      id: `${loaded.plugin.id}:${adapter.id}`,
      send: async (notification: Notification) => {
        if (loaded.stopped || !isActiveOn(loaded.plugin, notification.mapId)) return;
        try {
          await adapter.send(notification);
          loaded.failures = 0;
        } catch (error) {
          this.fail(loaded, error, `notifier ${adapter.id}`);
        }
      },
    });
    loaded.cleanups.push(remove);
  }

  private async settings(id: string, mapId: string | null): Promise<PluginSettingsValues> {
    const plugin = await this.deps.plugins.findById(id);
    if (!plugin) return {};
    const values = settingsFor(plugin, mapId);
    // Validation fills in the schema's defaults.
    const check = await this.deps.schemas.validate(plugin, values).catch(() => null);
    return check?.ok ? check.value : values;
  }
}

function mapIdOf(event: DomainEvent): string | null {
  const stream = parseStream(event.stream);
  return stream?.kind === 'map' ? stream.id : null;
}

function nestLogger(pluginId: string): PluginLogger {
  const logger = new Logger(`plugin:${pluginId}`);
  const text = (m: string, data?: unknown) => (data === undefined ? m : `${m} ${JSON.stringify(data)}`);
  return {
    debug: (m, d) => logger.debug(text(m, d)),
    info: (m, d) => logger.log(text(m, d)),
    warn: (m, d) => logger.warn(text(m, d)),
    error: (m, d) => logger.error(text(m, d)),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(why)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
