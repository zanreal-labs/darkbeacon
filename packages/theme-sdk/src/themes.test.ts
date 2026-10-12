import { describe, expect, it } from 'vitest';
import { themeToCss, themesToCss } from './css.js';
import { ThemeManifestSchema, isBuiltInTheme, parseThemeManifest, resolveTheme } from './manifest.js';
import { builtInThemes, darkTheme, lightTheme, resolveThemePreference, SYSTEM_THEME_ID } from './themes.js';
import { TOKEN_NAMES } from './tokens.js';

describe('themes', () => {
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
