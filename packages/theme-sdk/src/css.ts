import { TOKEN_NAMES, cssVarName } from './tokens.js';
import type { Theme } from './themes.js';

/** `selector { --dbk-token: value; ... color-scheme: ... }` */
export function themeToCss(theme: Theme, selector = ':root'): string {
  const lines = TOKEN_NAMES.map((name) => `  ${cssVarName(name)}: ${theme.tokens[name]};`);
  return `${selector} {\n  color-scheme: ${theme.colorScheme};\n${lines.join('\n')}\n}\n`;
}

/** One block per theme keyed by `[data-theme="<id>"]`, plus the first theme as `:root` default. */
export function themesToCss(themes: readonly Theme[]): string {
  const [first] = themes;
  const root = first ? themeToCss(first, ':root') : '';
  return root + themes.map((t) => themeToCss(t, `[data-theme="${t.id}"]`)).join('');
}

/**
 * Stylesheet for a page that must be right on its first paint, before any script runs: light on
 * `:root`, one block per theme under `[data-theme="<id>"]`, and for a page without `data-theme`
 * (the `system` preference) the dark and high-contrast themes from `prefers-color-scheme` and
 * `prefers-contrast` media queries, in the same order of precedence as `resolveThemePreference`.
 */
export function systemThemesCss(
  system: { light: Theme; dark: Theme; contrast: Theme },
  themes: readonly Theme[],
): string {
  const auto = ':root:not([data-theme])';
  return (
    themeToCss(system.light, ':root') +
    themes.map((t) => themeToCss(t, `[data-theme="${t.id}"]`)).join('') +
    `@media (prefers-color-scheme: dark) {\n${themeToCss(system.dark, auto)}}\n` +
    `@media (prefers-contrast: more) {\n${themeToCss(system.contrast, auto)}}\n`
  );
}
