import {
  INSTANCE_STREAM,
  NotFoundError,
  ValidationError,
  actorRef,
  newEvent,
  requireAccount,
  requireInstanceRole,
  type Actor,
  type ActorRef,
} from '@wormwright/core';
import type { CatalogEntryDto, PluginDto, PluginSettingsDto } from '@wormwright/shared';
import {
  disableAfterFailures,
  isActiveOn,
  newInstalledPlugin,
  setPluginEnabled,
  toPluginDto,
  upgradePlugin,
  withoutMap,
  type InstalledPlugin,
  type PluginSettingsValues,
} from '../domain/plugin.js';
import type { PackageSource } from '../domain/source.js';
import type { Clock, EventLog, UnitOfWork } from '../ports/index.js';
import type {
  PluginInstaller,
  PluginRepository,
  PluginSettingsSchemas,
  StagedPackage,
} from '../ports/plugin-repository.js';
import type { ThemeRepository } from '../ports/theme-repository.js';

export interface PluginAdminDeps {
  plugins: PluginRepository;
  themes: ThemeRepository;
  installer: PluginInstaller;
  schemas: PluginSettingsSchemas;
  uow: UnitOfWork;
  log: EventLog;
  clock: Clock;
}

/** The core itself, when it disables a failing plugin. */
const LOADER: ActorRef = { kind: 'system', id: 'plugin-loader' };
/** The core itself, when it cleans up after a deleted map. */
const CLEANUP: ActorRef = { kind: 'system', id: 'plugins' };

/** Admin use cases of the plugin registry. Changes are published as `plugin.*` instance events. */
export class PluginAdmin {
  constructor(private readonly deps: PluginAdminDeps) {}

  async list(actor: Actor | null): Promise<PluginDto[]> {
    requireInstanceRole(actor, 'admin');
    return (await this.deps.plugins.list()).map(toPluginDto);
  }

  async catalog(actor: Actor | null): Promise<CatalogEntryDto[]> {
    requireInstanceRole(actor, 'admin');
    const [entries, plugins, themes] = await Promise.all([
      this.deps.installer.catalog(),
      this.deps.plugins.list(),
      this.deps.themes.list(),
    ]);
    const installed = new Map<string, string>([
      ...plugins.map((p) => [`plugin:${p.id}`, p.manifest.version] as const),
      ...themes.map((t) => [`theme:${t.id}`, t.version] as const),
    ]);
    return entries.map((e) => ({ ...e, installedVersion: installed.get(`${e.kind}:${e.id}`) ?? null }));
  }

  /** Installs or upgrades a plugin. The loader picks the new code up through `PluginHost.sync`. */
  async install(actor: Actor | null, source: PackageSource): Promise<PluginDto> {
    const admin = requireInstanceRole(actor, 'admin');
    const staged = await this.deps.installer.stage(source);
    try {
      if (staged.kind !== 'plugin')
        throw new ValidationError('This package is a theme; install it as a theme');
      const existing = await this.deps.plugins.findById(staged.manifest.id);
      const now = this.deps.clock.now();
      const plugin = existing
        ? upgradePlugin(existing, staged.manifest, now)
        : newInstalledPlugin(staged.manifest, now);
      await this.deps.uow.transaction(async () => {
        await this.deps.plugins.save(plugin);
        await this.publish(plugin, actorRef(admin));
        // Last, so a failed database write leaves the previous version in place.
        await this.deps.installer.commit(staged);
      });
      return toPluginDto(plugin);
    } catch (error) {
      await this.discard(staged);
      throw error;
    }
  }

  async setEnabled(actor: Actor | null, id: string, enabled: boolean, mapId?: string): Promise<PluginDto> {
    const admin = requireInstanceRole(actor, 'admin');
    return this.change(id, actorRef(admin), (p) => setPluginEnabled(p, enabled, mapId));
  }

  async uninstall(actor: Actor | null, id: string): Promise<void> {
    const admin = requireInstanceRole(actor, 'admin');
    await this.deps.uow.transaction(async () => {
      await this.require(id);
      await this.deps.plugins.delete(id);
      await this.deps.log.append([
        newEvent({
          stream: INSTANCE_STREAM,
          type: 'plugin.removed',
          actor: actorRef(admin),
          data: { id },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
    });
    await this.deps.installer.remove(id);
  }

  async getSettings(actor: Actor | null, id: string, mapId?: string): Promise<PluginSettingsDto> {
    requireInstanceRole(actor, 'admin');
    const plugin = await this.require(id);
    return this.settingsDto(plugin, mapId ?? null);
  }

  /** Replaces the instance settings, or the overrides of one map. */
  async updateSettings(
    actor: Actor | null,
    id: string,
    values: PluginSettingsValues,
    mapId?: string,
  ): Promise<PluginSettingsDto> {
    requireInstanceRole(actor, 'admin');
    const plugin = await this.require(id);
    if (plugin.manifest.settings === null) throw new ValidationError('This plugin has no settings');
    // Map overrides are checked merged over the instance settings, as the plugin will read them.
    const merged = mapId === undefined ? values : { ...plugin.settings, ...values };
    const check = await this.deps.schemas.validate(plugin, merged);
    if (!check.ok) throw new ValidationError('Invalid settings', check.errors);
    const updated: InstalledPlugin =
      mapId === undefined
        ? { ...plugin, settings: check.value }
        : { ...plugin, mapSettings: { ...plugin.mapSettings, [mapId]: values } };
    await this.deps.plugins.save(updated);
    return this.settingsDto(updated, mapId ?? null);
  }

  /** Enabled plugins with a web part, for any signed-in account. */
  async webPlugins(actor: Actor | null): Promise<InstalledPlugin[]> {
    requireAccount(actor);
    return (await this.deps.plugins.list()).filter((p) => isActiveOn(p, null) && p.manifest.web !== null);
  }

  /** Drops a deleted map's per-map switches and settings; a reaction to `map.removed`. */
  async forgetMap(mapId: string): Promise<void> {
    for (const plugin of await this.deps.plugins.list()) {
      if (withoutMap(plugin, mapId)) await this.change(plugin.id, CLEANUP, (p) => withoutMap(p, mapId) ?? p);
    }
  }

  /** Called by the loader when a plugin keeps failing. */
  async disableFailing(id: string, reason: string, failureCount: number): Promise<PluginDto | null> {
    const plugin = await this.deps.plugins.findById(id);
    if (!plugin?.enabled) return null;
    return this.change(id, LOADER, (p) => disableAfterFailures(p, reason, failureCount));
  }

  private async change(
    id: string,
    actor: ActorRef,
    apply: (plugin: InstalledPlugin) => InstalledPlugin,
  ): Promise<PluginDto> {
    return this.deps.uow.transaction(async () => {
      const plugin = apply(await this.require(id));
      await this.deps.plugins.save(plugin);
      await this.publish(plugin, actor);
      return toPluginDto(plugin);
    });
  }

  private async publish(plugin: InstalledPlugin, actor: ActorRef): Promise<void> {
    await this.deps.log.append([
      newEvent({
        stream: INSTANCE_STREAM,
        type: 'plugin.updated',
        actor,
        data: toPluginDto(plugin),
        occurredAt: this.deps.clock.now(),
      }),
    ]);
  }

  private async settingsDto(plugin: InstalledPlugin, mapId: string | null): Promise<PluginSettingsDto> {
    return {
      schema: await this.deps.schemas.schemaOf(plugin),
      values: mapId === null ? plugin.settings : (plugin.mapSettings[mapId] ?? {}),
      mapId,
    };
  }

  private async require(id: string): Promise<InstalledPlugin> {
    const plugin = await this.deps.plugins.findById(id);
    if (!plugin) throw new NotFoundError('Plugin');
    return plugin;
  }

  private async discard(staged: StagedPackage): Promise<void> {
    await this.deps.installer.discard(staged).catch(() => undefined);
  }
}
