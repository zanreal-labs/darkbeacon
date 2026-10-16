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

/** Distance of two colours in OKLab (about 0.02 is a just noticeable difference). */
function oklabDistance(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

const STANDINGS = ['excellent', 'good', 'neutral', 'bad', 'terrible'] as const;

/** The client's standing tag backgrounds (https://wiki.eveuniversity.org/Color_Tag_Images). */
const GAME_STANDINGS = {
  excellent: '#042274',
  good: '#2c66c4',
  neutral: '#8c8a8c',
  bad: '#c44604',
  terrible: '#940604',
};

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
    'takes the game standing colours exactly, white text reading on all but neutral (%s)',
    (_, theme) => {
      expect(Object.fromEntries(STANDINGS.map((s) => [s, theme.tokens[`standing-${s}`]]))).toEqual(
        GAME_STANDINGS,
      );
      for (const s of ['excellent', 'good', 'bad', 'terrible'] as const) {
        expect(contrastRatio('#ffffff', theme.tokens[`standing-${s}`]), s).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(builtInThemes.map((t) => [t.name, t] as const))(
    'keeps node text readable on every standing tint and tells the five levels apart (%s)',
    (_, theme) => {
      const t = (name: TokenName) => theme.tokens[name];
      const tint = Number.parseFloat(t('node-tint-standing')) / 100;
      const muted = mixHex(t('node-text'), t('color-text-muted'), 0.25);
      const tinted = (s: (typeof STANDINGS)[number]) => mixHex(t(`standing-${s}`), t('node-bg'), tint);
      for (const s of ['excellent', 'good', 'bad', 'terrible'] as const) {
        for (const bg of [tinted(s), mixHex(t('node-text'), tinted(s), 0.06)]) {
          expect(contrastRatio(t('node-text'), bg), `${s} text`).toBeGreaterThanOrEqual(7);
          expect(contrastRatio(muted, bg), `${s} secondary text`).toBeGreaterThanOrEqual(4.5);
        }
        // Every level stands apart from a plain (neutral) node...
        expect(oklabDistance(tinted(s), t('node-bg')), `${s} vs plain`).toBeGreaterThanOrEqual(0.05);
      }
      // ...and as a wash, +10 from +5 (dark from light blue) and -10 from -5 (red from orange).
      expect(oklabDistance(tinted('excellent'), tinted('good'))).toBeGreaterThanOrEqual(0.04);
      expect(oklabDistance(tinted('terrible'), tinted('bad'))).toBeGreaterThanOrEqual(0.04);
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
