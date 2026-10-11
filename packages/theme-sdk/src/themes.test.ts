import { describe, expect, it } from 'vitest';
import { themeToCss, themesToCss } from './css.js';
import { ThemeManifestSchema, resolveTheme } from './manifest.js';
import { builtInThemes, darkTheme } from './themes.js';
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
    expect(css).toContain('--ww-edge-time-eol: #c77dea;');
    expect(themesToCss(builtInThemes)).toContain('[data-theme="contrast"]');
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
});
