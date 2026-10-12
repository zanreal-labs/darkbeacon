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
import { LEGEND_EDGE_STATES } from './MapLegend';

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
  it('gives every legend state its own look', () => {
    const looks = LEGEND_EDGE_STATES.map((s) => look(s.connection));
    expect(new Set(looks).size).toBe(LEGEND_EDGE_STATES.length);
  });

  it('draws time on the outside and mass in the core, at one width for every connection', () => {
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
    // An EOL with no known time stays purple.
    expect(edgeVisual({ ...base, timeStatus: 'eol', eolAt: null }).outer).toBe('edge-time-eol');

    // Size never changes the width.
    const widths = (['small', 'medium', 'large', 'xlarge', 'capital'] as const).map((shipSize) => {
      const v = edgeVisual({ ...base, shipSize });
      return [edgeOuterStyle(v).strokeWidth, edgeInnerStyle(v)?.strokeWidth];
    });
    expect(new Set(widths.map((w) => w.join()))).toEqual(new Set([widths[0]!.join()]));
    expect(edgeVisual({ ...base, dangerous: true }).halo).toBe(true);
  });

  it('writes only the size on the line, and nothing for large holes', () => {
    const base = connectionFixture('c', 1, 2);
    const letters = (['small', 'medium', 'large', 'xlarge', 'capital'] as const).map(
      (shipSize) => edgeVisual({ ...base, shipSize }).size,
    );
    expect(letters).toEqual(['S', 'M', null, 'XL', 'C']);
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

  it('draws gates and bridges as one layer, ignoring wormhole states', () => {
    const gate = edgeVisual(
      connectionFixture('g', 1, 2, { type: 'gate', timeStatus: 'eol', massStatus: 'critical' }),
    );
    expect(gate).toMatchObject({ outer: 'edge-gate', inner: null, dotted: false, size: null });
    const bridge = edgeVisual(connectionFixture('b', 1, 2, { type: 'bridge' }));
    expect(bridge).toMatchObject({ outer: 'edge-bridge', inner: null, dotted: true });
    expect(edgeOuterStyle(bridge).strokeDasharray).toMatch(/^0\.01 /);
  });
});
