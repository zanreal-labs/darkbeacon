import { describe, expect, it } from 'vitest';
import { systemThemesCss, themeToCss, themesToCss } from './css.js';
import { ThemeManifestSchema, isBuiltInTheme, parseThemeManifest, resolveTheme } from './manifest.js';
import {
  builtInThemes,
  contrastTheme,
  darkTheme,
  lightTheme,
  parseThemeCookie,
  resolveThemePreference,
  SYSTEM_THEME_ID,
  themeCookieValue,
} from './themes.js';
import { TOKEN_NAMES } from './tokens.js';

describe('themes', () => {
  it('carry a built-in fallback for theme packages in the cookie', () => {
    expect(themeCookieValue('dark')).toBe('dark');
    expect(themeCookieValue('amarr', 'dark')).toBe('amarr|dark');
    expect(themeCookieValue('sunset', 'light')).toBe('sunset|default');
    expect(parseThemeCookie('amarr|dark')).toEqual({ themeId: 'amarr', fallback: 'dark' });
    expect(parseThemeCookie('system')).toEqual({ themeId: 'system', fallback: null });
  });

  it('define every token and nothing else', () => {
    for (const theme of builtInThemes) {
      expect(Object.keys(theme.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
    }
  });

  it('render css variables', () => {
    const css = themeToCss(darkTheme);
    expect(css).toContain(':root {');
    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('--dbk-edge-time-eol: #cf7cf2;');
    expect(themesToCss(builtInThemes)).toContain('[data-theme="contrast"]');
  });

  it('follow the system in css alone when no theme is picked', () => {
    const css = systemThemesCss(
      { light: lightTheme, dark: darkTheme, contrast: contrastTheme },
      builtInThemes,
    );
    const dark = css.indexOf('@media (prefers-color-scheme: dark)');
    const contrast = css.indexOf('@media (prefers-contrast: more)');
    // Light first, explicit themes next, then the media queries (contrast wins over dark, as in JS).
    expect(css.startsWith(':root {')).toBe(true);
    expect(css.indexOf('[data-theme="dark"]')).toBeLessThan(dark);
    expect(dark).toBeLessThan(contrast);
    expect(css.slice(dark, contrast)).toContain(':root:not([data-theme]) {');
    expect(css.slice(dark, contrast)).toContain(`--dbk-color-bg: ${darkTheme.tokens['color-bg']};`);
    expect(css.slice(contrast)).toContain('--dbk-color-bg: #000000;');
  });

  it('read light and dark from one palette', () => {
    expect(lightTheme.id).toBe('default');
    expect(lightTheme.colorScheme).toBe('light');
    expect(lightTheme.tokens['font-family']).toBe(darkTheme.tokens['font-family']);
    expect(lightTheme.tokens['color-bg']).not.toBe(darkTheme.tokens['color-bg']);
    // Derived colours follow whatever accent a theme sets.
    expect(darkTheme.tokens['color-accent-subtle']).toContain('var(--dbk-color-accent)');
  });

  it('resolve the system preference from the operating system', () => {
    expect(resolveThemePreference(SYSTEM_THEME_ID, { dark: false })).toBe('default');
    expect(resolveThemePreference(SYSTEM_THEME_ID, { dark: true })).toBe('dark');
    expect(resolveThemePreference(SYSTEM_THEME_ID, { dark: true, moreContrast: true })).toBe('contrast');
    expect(resolveThemePreference('amarr', { dark: false })).toBe('amarr');
  });

  it('resolves a theme manifest over its base', () => {
    const manifest = ThemeManifestSchema.parse({
      id: 'amarr',
      name: 'Amarr',
      version: '1.0.0',
      colorScheme: 'dark',
      extends: 'dark',
      tokens: { 'color-accent': '#d4a017' },
    });
    const theme = resolveTheme(manifest);
    expect(theme.tokens['color-accent']).toBe('#d4a017');
    expect(theme.tokens['color-bg']).toBe(darkTheme.tokens['color-bg']);
    expect(ThemeManifestSchema.safeParse({ ...manifest, tokens: { nope: 'x' } }).success).toBe(false);
    expect(ThemeManifestSchema.safeParse({ ...manifest, tokens: { radius: '1px; }' } }).success).toBe(false);
  });

  it('parses theme package manifests with readable errors', () => {
    expect(parseThemeManifest({ id: 'x', name: 'X' })).toMatchObject({ ok: false });
    const result = parseThemeManifest({
      id: 'sunset',
      name: 'Sunset',
      version: '1.0.0',
      colorScheme: 'light',
      tokens: {},
    });
    expect(result).toMatchObject({ ok: true, manifest: { extends: 'default', tokens: {} } });
    expect(isBuiltInTheme('dark')).toBe(true);
    expect(isBuiltInTheme('sunset')).toBe(false);
  });
});
