import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const PluginDto = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  /** Set when the core disabled the plugin after repeated failures. */
  error: z.string().nullable(),
  hasWeb: z.boolean(),
  description: z.string().nullable(),
  /** Ports the plugin receives (its permissions), from the manifest. */
  ports: z.array(z.string()),
  /** Event types it may subscribe to, from the manifest. */
  events: z.array(z.string()),
  /** Maps the plugin is switched off on although enabled on the instance. */
  disabledMapIds: z.array(Id),
  hasSettings: z.boolean(),
  installedAt: Timestamp,
});
export type PluginDto = z.infer<typeof PluginDto>;

/**
 * `source` is `catalog:<name>` for a package shipped with the server, or an npm package name
 * with an optional exact version or tag (`darkbeacon-plugin-x`, `@scope/x@1.2.0`).
 * Uploaded .tgz files go to the `upload` routes instead.
 */
export const InstallPluginRequest = z.object({ source: z.string().trim().min(1) });
export type InstallPluginRequest = z.infer<typeof InstallPluginRequest>;

export const SetPluginEnabledRequest = z.object({ enabled: z.boolean(), mapId: Id.optional() });
export type SetPluginEnabledRequest = z.infer<typeof SetPluginEnabledRequest>;

/** A package shipped with the server (first-party plugins and themes). */
export const CatalogEntryDto = z.object({
  source: z.string(),
  kind: z.enum(['plugin', 'theme']),
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
  /** Version installed on this instance, null when not installed. */
  installedVersion: z.string().nullable(),
});
export type CatalogEntryDto = z.infer<typeof CatalogEntryDto>;

export const PluginSettingsQuery = z.object({ mapId: Id.optional() });
export type PluginSettingsQuery = z.infer<typeof PluginSettingsQuery>;

/** Settings of a plugin on the instance (no mapId) or on one map (overrides only). */
export const PluginSettingsDto = z.object({
  /** The manifest's JSON Schema, null when the plugin has no settings. */
  schema: z.unknown().nullable(),
  values: z.record(z.string(), z.unknown()),
  mapId: Id.nullable(),
});
export type PluginSettingsDto = z.infer<typeof PluginSettingsDto>;

export const UpdatePluginSettingsRequest = z.object({
  values: z.record(z.string(), z.unknown()),
  mapId: Id.optional(),
});
export type UpdatePluginSettingsRequest = z.infer<typeof UpdatePluginSettingsRequest>;

/** GET /api/plugins/web item: an enabled plugin's web entry for the SPA loader. */
export const PluginWebDto = z.object({
  id: z.string(),
  url: z.string(),
  disabledMapIds: z.array(Id),
});
export type PluginWebDto = z.infer<typeof PluginWebDto>;
