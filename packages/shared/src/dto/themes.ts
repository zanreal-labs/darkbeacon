import { z } from 'zod';

export const ThemeDto = z.object({
  id: z.string(),
  name: z.string(),
  /** Null for built-in themes. */
  version: z.string().nullable(),
  colorScheme: z.enum(['light', 'dark']),
  builtIn: z.boolean(),
  /** Every token of the catalogue (`color-bg` -> value); write them as `--dbk-<token>`. */
  tokens: z.record(z.string(), z.string()),
});
export type ThemeDto = z.infer<typeof ThemeDto>;

/** GET /api/themes */
export const ThemesDto = z.object({
  themes: z.array(ThemeDto),
  /** Instance default, set by an admin. */
  defaultThemeId: z.string(),
  /** The signed-in account's own choice; null = follow the default. */
  selectedThemeId: z.string().nullable(),
});
export type ThemesDto = z.infer<typeof ThemesDto>;

export const SelectThemeRequest = z.object({ themeId: z.string().min(1).nullable() });
export type SelectThemeRequest = z.infer<typeof SelectThemeRequest>;

export const SetDefaultThemeRequest = z.object({ themeId: z.string().min(1) });
export type SetDefaultThemeRequest = z.infer<typeof SetDefaultThemeRequest>;
