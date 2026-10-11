import { TOKEN_NAMES, cssVarName } from './tokens.js';
import type { Theme } from './themes.js';

/** `selector { --ww-token: value; ... color-scheme: ... }` */
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
