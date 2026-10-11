import { z } from 'zod';

/** Ports a plugin may ask for in its manifest; it receives only those. */
export const PLUGIN_PORTS = ['maps', 'universe', 'events', 'notifier', 'clock'] as const;
export type PluginPortName = (typeof PLUGIN_PORTS)[number];

export const SDK_VERSION = '1.0.0';
export const MANIFEST_FILE = 'wormwright-plugin.json';

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must be a path inside the package');

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'semver'),
  /** Semver range of the plugin SDK the plugin was built against, e.g. `^1.0`. */
  sdk: z.string().min(1),
  server: relativePath.optional(),
  web: relativePath.optional(),
  ports: z.array(z.enum(PLUGIN_PORTS)).default([]),
  /** Event types (or `prefix.*`) the plugin subscribes to. */
  events: z.array(z.string().min(1)).default([]),
  settings: relativePath.optional(),
  migrations: relativePath.optional(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

export function parseManifest(input: unknown): ManifestResult {
  const parsed = PluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`),
    };
  }
  if (!parsed.data.server && !parsed.data.web) {
    return { ok: false, errors: ['manifest: needs a server or a web entry'] };
  }
  if (!sdkCompatible(parsed.data.sdk)) {
    return { ok: false, errors: [`sdk: ${parsed.data.sdk} is not compatible with ${SDK_VERSION}`] };
  }
  return { ok: true, manifest: parsed.data };
}

/** Accepts `^1`, `^1.0`, `1.x` style ranges on the current major. */
export function sdkCompatible(range: string): boolean {
  const major = /^[\^~]?(\d+)(?:\.(?:\d+|x))*$/.exec(range.trim())?.[1];
  return major !== undefined && major === SDK_VERSION.split('.')[0];
}
