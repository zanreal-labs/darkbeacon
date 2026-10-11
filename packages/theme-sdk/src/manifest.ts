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
