import { z } from 'zod';
import { Id } from './common.js';

export const PluginDto = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  /** Set when the core disabled the plugin after repeated failures. */
  error: z.string().nullable(),
  hasWeb: z.boolean(),
});
export type PluginDto = z.infer<typeof PluginDto>;

export const InstallPluginRequest = z.object({ source: z.string().trim().min(1) });
export type InstallPluginRequest = z.infer<typeof InstallPluginRequest>;

export const SetPluginEnabledRequest = z.object({ enabled: z.boolean(), mapId: Id.optional() });
export type SetPluginEnabledRequest = z.infer<typeof SetPluginEnabledRequest>;
