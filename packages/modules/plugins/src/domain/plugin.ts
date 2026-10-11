import type { PluginDto } from '@wormwright/shared';

/**
 * What the core keeps from a plugin manifest. The installer validates the manifest with
 * plugin-sdk before it gets here; paths are relative to the plugin's directory.
 */
export interface PluginManifestSummary {
  id: string;
  name: string;
  version: string;
  description: string | null;
  server: string | null;
  web: string | null;
  settings: string | null;
  migrations: string | null;
  ports: string[];
  events: string[];
}

export type PluginSettingsValues = Record<string, unknown>;

/** A plugin installed into DATA_DIR/plugins/<id>. */
export interface InstalledPlugin {
  id: string;
  manifest: PluginManifestSummary;
  enabled: boolean;
  /** Maps where the plugin is switched off although enabled on the instance. */
  disabledMapIds: string[];
  failureCount: number;
  /** Why the core disabled the plugin; cleared when an admin enables it again. */
  error: string | null;
  settings: PluginSettingsValues;
  /** Per-map overrides on top of `settings`. */
  mapSettings: Record<string, PluginSettingsValues>;
  installedAt: number;
}

/** A fresh install starts disabled, so the admin reviews its permissions before it runs. */
export function newInstalledPlugin(manifest: PluginManifestSummary, now: number): InstalledPlugin {
  return {
    id: manifest.id,
    manifest,
    enabled: false,
    disabledMapIds: [],
    failureCount: 0,
    error: null,
    settings: {},
    mapSettings: {},
    installedAt: now,
  };
}

/** A new version keeps enablement and settings and starts with a clean failure record. */
export function upgradePlugin(
  existing: InstalledPlugin,
  manifest: PluginManifestSummary,
  now: number,
): InstalledPlugin {
  return { ...existing, manifest, failureCount: 0, error: null, installedAt: now };
}

export function setPluginEnabled(plugin: InstalledPlugin, enabled: boolean, mapId?: string): InstalledPlugin {
  if (mapId === undefined) {
    return enabled
      ? { ...plugin, enabled: true, failureCount: 0, error: null }
      : { ...plugin, enabled: false };
  }
  const others = plugin.disabledMapIds.filter((id) => id !== mapId);
  return { ...plugin, disabledMapIds: enabled ? others : [...others, mapId] };
}

export function disableAfterFailures(
  plugin: InstalledPlugin,
  reason: string,
  failureCount: number,
): InstalledPlugin {
  return { ...plugin, enabled: false, failureCount, error: reason };
}

/** Runs on the instance (mapId null) or on that map. */
export function isActiveOn(plugin: InstalledPlugin, mapId: string | null): boolean {
  return plugin.enabled && (mapId === null || !plugin.disabledMapIds.includes(mapId));
}

/** Instance settings with the map's overrides on top. */
export function settingsFor(plugin: InstalledPlugin, mapId: string | null): PluginSettingsValues {
  return mapId === null ? plugin.settings : { ...plugin.settings, ...plugin.mapSettings[mapId] };
}

/** Changes whenever new code is installed, even with the same version number. */
export function pluginRevision(plugin: InstalledPlugin): string {
  return `${plugin.manifest.version}@${plugin.installedAt}`;
}

export function toPluginDto(plugin: InstalledPlugin): PluginDto {
  const m = plugin.manifest;
  return {
    id: plugin.id,
    name: m.name,
    version: m.version,
    description: m.description,
    enabled: plugin.enabled,
    error: plugin.error,
    hasWeb: m.web !== null,
    ports: m.ports,
    events: m.events,
    disabledMapIds: plugin.disabledMapIds,
    hasSettings: m.settings !== null,
    installedAt: plugin.installedAt,
  };
}
