import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn } from './contrast.js';
import { builtInThemes } from './themes.js';
import type { TokenName } from './tokens.js';

/** `a` laid over `b` at `share` (0..1), in sRGB as the browser composites it. */
function mixHex(a: string, b: string, share: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x
    .map((c, i) => Math.round(c * share + y[i]! * (1 - share)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

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
      expect(contrastRatio(t('node-text'), t('node-bg'))).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t('color-text-muted'), t('node-bg'))).toBeGreaterThanOrEqual(4.5);
      for (const pill of ['pill-wormhole', 'pill-special'] as const) {
        expect(contrastRatio(t('node-pill-text'), t(pill))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(builtInThemes.map((t) => [t.name, t] as const))(
    'keeps node text readable on every status tint, also when selected (%s)',
    (_, theme) => {
      const t = (name: TokenName) => theme.tokens[name];
      // As the node draws it: `node-tint` of the status colour over the background at its
      // strongest edge, then the selection lift (6 % of the text colour); secondary text is a
      // quarter of the way from muted to the node text (`--node-muted`).
      const tint = Number.parseFloat(t('node-tint')) / 100;
      const muted = mixHex(t('node-text'), t('color-text-muted'), 0.25);
      const statuses = ['home', 'friendly', 'empty', 'occupied', 'warning', 'hostile', 'target'] as const;
      for (const status of statuses) {
        const tinted = mixHex(t(`status-${status}`), t('node-bg'), tint);
        for (const bg of [tinted, mixHex(t('node-text'), tinted, 0.06)]) {
          expect(contrastRatio(t('node-text'), bg), `${status} text`).toBeGreaterThanOrEqual(7);
          expect(contrastRatio(muted, bg), `${status} secondary text`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // A tint is there to be seen: every status stands apart from the plain node.
      for (const status of statuses) {
        const tinted = mixHex(t(`status-${status}`), t('node-bg'), tint);
        expect(tinted, status).not.toBe(t('node-bg'));
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
