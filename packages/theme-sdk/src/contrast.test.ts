import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn } from './contrast.js';
import { builtInThemes } from './themes.js';
import type { TokenName } from './tokens.js';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(readableTextOn('#f0c541')).toBe('#000000');
    expect(readableTextOn('#4760dd')).toBe('#ffffff');
  });

  it.each(builtInThemes.map((t) => [t.name, t] as const))(
    'keeps node text and the dark pill text readable (%s)',
    (_, theme) => {
      const t = (name: TokenName) => theme.tokens[name];
      // Nodes have no tint any more: text on the plain node background.
      expect(contrastRatio(t('node-text'), t('node-bg'))).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t('color-text-muted'), t('node-bg'))).toBeGreaterThanOrEqual(4.5);
      for (const pill of ['pill-wormhole', 'pill-special'] as const) {
        expect(contrastRatio(t('node-pill-text'), t(pill))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(builtInThemes.map((t) => [t.name, t] as const))(
    'tells the connection states apart by colour (%s)',
    (_, theme) => {
      const t = (name: TokenName) => theme.tokens[name];
      const outer = (['edge-color', 'edge-time-eol', 'edge-time-critical'] as const).map(t);
      const inner = (['edge-mass-fresh', 'edge-mass-reduced', 'edge-mass-critical'] as const).map(t);
      expect(new Set(outer).size).toBe(3);
      expect(new Set(inner).size).toBe(3);
    },
  );
});
