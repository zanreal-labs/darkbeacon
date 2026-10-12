import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn } from './contrast.js';
import { builtInThemes } from './themes.js';
import type { TokenName } from './tokens.js';

const STATUSES = [
  'unknown',
  'home',
  'friendly',
  'empty',
  'occupied',
  'warning',
  'hostile',
  'target',
] as const;

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(readableTextOn('#f0c541')).toBe('#000000');
    expect(readableTextOn('#4760dd')).toBe('#ffffff');
  });

  it.each(builtInThemes.map((t) => [t.name, t] as const))(
    'keeps node text readable on every status tint (%s)',
    (_, theme) => {
      const t = (name: TokenName) => theme.tokens[name];
      const tints = STATUSES.map((s) => t(`node-status-${s}`));
      // One distinct tint per status.
      expect(new Set(tints).size).toBe(STATUSES.length);
      for (const tint of tints) {
        expect(contrastRatio(t('node-text'), tint)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t('color-text-muted'), tint)).toBeGreaterThanOrEqual(4.5);
      }
      for (const pill of ['security-wormhole', 'security-special'] as const) {
        expect(contrastRatio(t('node-pill-text'), t(pill))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
