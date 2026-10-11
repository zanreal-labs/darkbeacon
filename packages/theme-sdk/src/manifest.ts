import { z } from 'zod';
import { TOKENS, type TokenName } from './tokens.js';
import { builtInThemes, type Theme } from './themes.js';

/** A theme package: metadata plus token overrides on top of a built-in theme. No code. */
export const ThemeManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(64),
  version: z.string().min(1),
  colorScheme: z.enum(['light', 'dark']),
  extends: z.enum(['default', 'dark', 'contrast']).default('default'),
  tokens: z
    .record(z.string(), z.string().max(200))
    .refine((t) => Object.keys(t).every((k) => k in TOKENS), 'unknown token')
    .refine(
      (t) => Object.values(t).every((v) => !/[;{}<>]/.test(v)),
      'token values may not contain ; { } < >',
    ),
});
export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

/** File name of the manifest at the root of a theme package. */
export const THEME_MANIFEST_FILE = 'wormwright-theme.json';

export type ThemeManifestResult = { ok: true; manifest: ThemeManifest } | { ok: false; errors: string[] };

export function parseThemeManifest(input: unknown): ThemeManifestResult {
  const parsed = ThemeManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`),
  };
}

export function isBuiltInTheme(id: string): boolean {
  return builtInThemes.some((t) => t.id === id);
}

export function resolveTheme(manifest: ThemeManifest): Theme {
  const base = builtInThemes.find((t) => t.id === manifest.extends);
  if (!base) throw new Error(`unknown base theme ${manifest.extends}`);
  return {
    id: manifest.id,
    name: manifest.name,
    colorScheme: manifest.colorScheme,
    tokens: { ...base.tokens, ...(manifest.tokens as Partial<Record<TokenName, string>>) },
  };
}
