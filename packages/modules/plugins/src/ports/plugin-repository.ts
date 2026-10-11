import type { InstalledPlugin, PluginManifestSummary, PluginSettingsValues } from '../domain/plugin.js';
import type { PackageSource } from '../domain/source.js';
import type { InstalledTheme } from '../domain/theme.js';

export interface PluginRepository {
  list(): Promise<InstalledPlugin[]>;
  findById(id: string): Promise<InstalledPlugin | null>;
  /** Inserts or replaces. */
  save(plugin: InstalledPlugin): Promise<void>;
  delete(id: string): Promise<void>;
}

/** A downloaded, unpacked and validated package waiting in a staging directory. */
export type StagedPackage =
  | { kind: 'plugin'; manifest: PluginManifestSummary; directory: string }
  | { kind: 'theme'; theme: Omit<InstalledTheme, 'installedAt'>; directory: string };

export interface CatalogEntry {
  /** What to pass as the install source, e.g. `catalog:discord-notify`. */
  source: string;
  kind: 'plugin' | 'theme';
  id: string;
  name: string;
  version: string;
  description: string | null;
}

/** Fetches plugin and theme packages (catalogue, npm, upload) and manages plugin files. */
export interface PluginInstaller {
  /** Downloads, unpacks and validates the package. Throws ValidationError for a bad package. */
  stage(source: PackageSource): Promise<StagedPackage>;
  /** Moves a staged plugin to its final directory, replacing an older version. */
  commit(staged: StagedPackage): Promise<void>;
  /** Deletes a staged package that will not be installed. */
  discard(staged: StagedPackage): Promise<void>;
  /** Deletes an installed plugin's files. */
  remove(pluginId: string): Promise<void>;
  catalog(): Promise<CatalogEntry[]>;
}

export type SettingsCheck =
  { ok: true; value: PluginSettingsValues } | { ok: false; errors: Array<{ path: string; message: string }> };

/** Reads and applies the JSON Schema a plugin declares for its settings. */
export interface PluginSettingsSchemas {
  /** The schema, or null when the plugin has no settings. */
  schemaOf(plugin: InstalledPlugin): Promise<unknown>;
  validate(plugin: InstalledPlugin, values: PluginSettingsValues): Promise<SettingsCheck>;
}
