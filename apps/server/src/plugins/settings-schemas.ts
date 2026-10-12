import { join } from 'node:path';
import { settingsValidator, type SettingsValidator } from '@darkbeacon/plugin-sdk';
import {
  pluginRevision,
  type InstalledPlugin,
  type PluginSettingsSchemas,
  type PluginSettingsValues,
  type SettingsCheck,
} from '@darkbeacon/plugins';
import { readJson } from './installer.js';

/** Reads `settings.schema.json` (or whatever the manifest names) from the plugin directory once per revision. */
export class FilePluginSettingsSchemas implements PluginSettingsSchemas {
  private readonly cache = new Map<string, { schema: unknown; validate: SettingsValidator }>();

  constructor(private readonly pluginDir: (id: string) => string) {}

  async schemaOf(plugin: InstalledPlugin): Promise<unknown> {
    return (await this.load(plugin))?.schema ?? null;
  }

  async validate(plugin: InstalledPlugin, values: PluginSettingsValues): Promise<SettingsCheck> {
    const loaded = await this.load(plugin);
    return loaded ? loaded.validate(values) : { ok: true, value: values };
  }

  private async load(plugin: InstalledPlugin) {
    if (plugin.manifest.settings === null) return null;
    const key = `${plugin.id}@${pluginRevision(plugin)}`;
    let entry = this.cache.get(key);
    if (!entry) {
      const schema = await readJson(join(this.pluginDir(plugin.id), plugin.manifest.settings));
      entry = { schema, validate: settingsValidator(schema) };
      this.cache.set(key, entry);
    }
    return entry;
  }
}
