import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtInThemes, contrastRatio } from '@darkbeacon/theme-sdk';

// Tests run from the repository root (see vitest.config.ts).
const css = readFileSync(join(process.cwd(), 'apps/web/src/ui/overlay.module.css'), 'utf8');

/** The declarations of the first `.name { ... }` rule. */
function rule(name: string): Record<string, string> {
  const body = new RegExp(`^\\.${name} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
  const declarations: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+):\s*([^;]+);/g)) {
    declarations[m[1]!] = m[2]!.trim();
  }
  return declarations;
}

describe('tooltip surface', () => {
  it('uses the raised surface and text colour of the theme, so it follows light, dark and contrast', () => {
    const tooltip = rule('tooltip');
    expect(tooltip.background).toBe('var(--dbk-color-surface-raised)');
    expect(tooltip.color).toBe('var(--dbk-color-text)');
    // The popover and menu surface it must match; an inverted tooltip is light in dark themes.
    const surface = rule('surface');
    expect(tooltip.background).toBe(surface.background);
    expect(tooltip.color).toBe(surface.color);
  });

  it('keeps muted and subtle text readable on it in every built-in theme', () => {
    for (const theme of builtInThemes) {
      const background = theme.tokens['color-surface-raised'];
      for (const token of ['color-text', 'color-text-muted', 'color-text-subtle'] as const) {
        expect(contrastRatio(theme.tokens[token], background), `${theme.id} ${token}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });
});
