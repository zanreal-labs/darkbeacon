import { describe, expect, it } from 'vitest';
import { connectionFixture } from '../test/fixtures';
import {
  edgeInnerStyle,
  edgeOuterStyle,
  edgeVisual,
  eolRemaining,
  EOL_WINDOW_MS,
  TIME_CRITICAL_MS,
} from './edgeStyle';
import { LEGEND_EDGE_STATES, LEGEND_SAME_AS } from './MapLegend';

/** Everything a viewer can see of a connection, as one comparable string. */
function look(c: Parameters<typeof edgeVisual>[0], now = 1_000_000_000_000): string {
  const v = edgeVisual(c, now);
  return JSON.stringify({
    outer: edgeOuterStyle(v),
    inner: edgeInnerStyle(v),
    halo: v.halo,
    bubbles: v.bubbles,
    size: v.size,
  });
}

describe('edge visual language', () => {
  it('gives every legend state its own look, but for L, which looks like a healthy hole', () => {
    const own = LEGEND_EDGE_STATES.filter((s) => !(s.key in LEGEND_SAME_AS));
    expect(new Set(own.map((s) => look(s.connection))).size).toBe(own.length);
    const byKey = new Map(LEGEND_EDGE_STATES.map((s) => [s.key, s.connection]));
    for (const [key, same] of Object.entries(LEGEND_SAME_AS))
      expect(look(byKey.get(key)!)).toBe(look(byKey.get(same)!));
  });

  it('lists the game sizes S, M, L and XL in the legend, and no capital size', () => {
    const sizes = LEGEND_EDGE_STATES.filter((s) => s.connection.type === 'wormhole').map(
      (s) => s.label.split(':')[0],
    );
    expect(sizes).toEqual(expect.arrayContaining(['S', 'M', 'No letter', 'XL']));
    expect(LEGEND_EDGE_STATES.find((s) => s.key === 'large')!.label).toContain('L, up to battleships');
    expect(
      LEGEND_EDGE_STATES.some((s) => s.connection.shipSize === 'capital' && s.connection.type === 'wormhole'),
    ).toBe(false);
  });

  it('draws time on the outside and mass in the core, at one width for every size', () => {
    const base = connectionFixture('c', 1, 2);
    expect(edgeVisual(base)).toMatchObject({
      outer: 'edge-color',
      inner: 'edge-mass-fresh',
      halo: false,
      size: null,
    });
    expect(edgeVisual({ ...base, massStatus: 'reduced' })).toMatchObject({
      outer: 'edge-color',
      inner: 'edge-mass-reduced',
    });
    expect(edgeVisual({ ...base, massStatus: 'critical' }).inner).toBe('edge-mass-critical');
    const now = 10 * EOL_WINDOW_MS;
    expect(edgeVisual({ ...base, timeStatus: 'eol', eolAt: now - 60 * 60_000 }, now)).toMatchObject({
      outer: 'edge-time-eol',
      inner: 'edge-mass-fresh',
      time: 'eol',
    });
    // Under an hour left: pink outside.
    const late = now - EOL_WINDOW_MS + TIME_CRITICAL_MS - 60_000;
    expect(edgeVisual({ ...base, timeStatus: 'eol', eolAt: late }, now)).toMatchObject({
      outer: 'edge-time-critical',
      time: 'critical',
    });
    // The game's "less than 1 hour" and "expired" marks are pink too, whenever EOL was marked.
    const marked = (mark: '1h' | 'expired') =>
      edgeVisual({ ...base, timeStatus: 'eol', eolAt: now, lifetime: { mark, at: now } }, now);
    expect(marked('1h')).toMatchObject({ outer: 'edge-time-critical', time: 'critical' });
    expect(marked('expired')).toMatchObject({ outer: 'edge-time-critical', time: 'critical' });
    // An EOL with no known time stays purple.
    expect(edgeVisual({ ...base, timeStatus: 'eol', eolAt: null }).outer).toBe('edge-time-eol');

    // Size never changes the width.
    const widths = (['small', 'medium', 'large', 'xlarge', 'capital'] as const).map((shipSize) => {
      const v = edgeVisual({ ...base, shipSize });
      return [edgeOuterStyle(v).strokeWidth, edgeInnerStyle(v)?.strokeWidth];
    });
    expect(new Set(widths.map((w) => w.join()))).toEqual(new Set([widths[0]!.join()]));
    expect(edgeVisual({ ...base, dangerous: true }).halo).toBe(true);
    // End of life widens the outer layer, never the core.
    const eol = edgeVisual({ ...base, timeStatus: 'eol', eolAt: now - 60 * 60_000 }, now);
    expect(edgeOuterStyle(eol).strokeWidth).toBe('calc(var(--dbk-edge-width) + 2px)');
    expect(edgeInnerStyle(eol)?.strokeWidth).toBe(edgeInnerStyle(edgeVisual(base))?.strokeWidth);
  });

  it('writes only the size on the line, and nothing for large holes', () => {
    const base = connectionFixture('c', 1, 2);
    const letters = (['small', 'medium', 'large', 'xlarge', 'capital'] as const).map(
      (shipSize) => edgeVisual({ ...base, shipSize }).size,
    );
    // The game's sizes: capital holes are XL too.
    expect(letters).toEqual(['S', 'M', null, 'XL', 'XL']);
    // Everything else is for the hover card.
    const v = edgeVisual({ ...base, dangerous: true, massStatus: 'critical', massSaved: true });
    expect(v.size).toBeNull();
    expect(v.states.map((s) => s.kind)).toEqual(['dangerous', 'critical', 'saved']);
  });

  it('counts EOL down from when it was marked', () => {
    expect(eolRemaining(null, 0)).toBeNull();
    expect(eolRemaining(0, 0)).toBe('~4h');
    expect(eolRemaining(0, 65 * 60_000)).toBe('~2h55m');
    expect(eolRemaining(0, EOL_WINDOW_MS - 20 * 60_000)).toBe('~20m');
    expect(eolRemaining(0, EOL_WINDOW_MS + 60_000)).toBe('~0m');
  });

  it('draws gates around a fresh core and bridges as one layer, ignoring wormhole states', () => {
    const gate = edgeVisual(
      connectionFixture('g', 1, 2, { type: 'gate', timeStatus: 'eol', massStatus: 'critical' }),
    );
    expect(gate).toMatchObject({
      outer: 'edge-gate',
      inner: 'edge-mass-fresh',
      time: 'normal',
      dotted: false,
      size: null,
    });
    const bridge = edgeVisual(connectionFixture('b', 1, 2, { type: 'bridge' }));
    expect(bridge).toMatchObject({ outer: 'edge-bridge', inner: null, dotted: true });
    expect(edgeOuterStyle(bridge).strokeDasharray).toMatch(/^0\.01 /);
  });
});
