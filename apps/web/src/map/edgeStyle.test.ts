import { describe, expect, it } from 'vitest';
import { connectionFixture } from '../test/fixtures';
import { edgeLineStyle, edgeVisual, eolRemaining, EOL_WINDOW_MS, MAX_EDGE_BADGES } from './edgeStyle';
import { LEGEND_EDGE_STATES } from './MapLegend';

/** Everything a viewer can see of a connection, as one comparable string. */
function look(c: Parameters<typeof edgeVisual>[0]): string {
  const v = edgeVisual(c, 0);
  return JSON.stringify({
    line: edgeLineStyle(v),
    halo: v.halo,
    bubbles: v.bubbles,
    badges: v.badges.map((b) => b.label),
  });
}

describe('edge visual language', () => {
  it('gives every legend state its own look', () => {
    const looks = LEGEND_EDGE_STATES.map((s) => look(s.connection));
    expect(new Set(looks).size).toBe(LEGEND_EDGE_STATES.length);
  });

  it('keeps each property on its own channel', () => {
    const base = connectionFixture('c', 1, 2);
    const healthy = edgeVisual(base);
    expect(healthy).toMatchObject({ stroke: 'edge-color', width: 1, dash: null, halo: false, badges: [] });

    // Mass is colour (critical a little thicker too); time is the dash; size is the width.
    expect(edgeVisual({ ...base, massStatus: 'reduced' })).toMatchObject({
      stroke: 'edge-mass-reduced',
      width: 1,
    });
    const critical = edgeVisual({ ...base, massStatus: 'critical' });
    expect(critical.stroke).toBe('edge-mass-critical');
    expect(critical.width).toBeGreaterThan(1);
    expect(edgeVisual({ ...base, timeStatus: 'eol' })).toMatchObject({
      stroke: 'edge-color',
      dash: 'eol',
      width: 1,
    });
    const widths = (['small', 'medium', 'large', 'xlarge'] as const).map(
      (shipSize) => edgeVisual({ ...base, shipSize }).width,
    );
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(4);
    expect(edgeVisual({ ...base, dangerous: true }).halo).toBe(true);
  });

  it('shows only the two most urgent badges and keeps the rest for the tooltip', () => {
    const v = edgeVisual(
      connectionFixture('c', 1, 2, {
        dangerous: true,
        timeStatus: 'eol',
        massStatus: 'critical',
        shipSize: 'small',
      }),
    );
    expect(v.badges.map((b) => b.kind)).toEqual(['dangerous', 'eol']);
    expect(v.badges).toHaveLength(MAX_EDGE_BADGES);
    expect(v.states.map((b) => b.kind)).toEqual(['dangerous', 'eol', 'critical', 'frigate']);
  });

  it('labels frigate holes F and counts EOL down from when it was marked', () => {
    expect(edgeVisual(connectionFixture('c', 1, 2, { shipSize: 'small' })).badges[0]?.label).toBe('F');
    expect(eolRemaining(null, 0)).toBeNull();
    expect(eolRemaining(0, 0)).toBe('~4h');
    expect(eolRemaining(0, 65 * 60_000)).toBe('~2h55m');
    expect(eolRemaining(0, EOL_WINDOW_MS - 20 * 60_000)).toBe('~20m');
    expect(eolRemaining(0, EOL_WINDOW_MS + 60_000)).toBe('~0m');
  });

  it('ignores wormhole states on gates and bridges', () => {
    const gate = edgeVisual(
      connectionFixture('g', 1, 2, { type: 'gate', timeStatus: 'eol', massStatus: 'critical' }),
    );
    expect(gate).toMatchObject({ stroke: 'edge-gate', dash: null, width: 1 });
    expect(gate.badges.map((b) => b.kind)).toEqual(['gate']);
    expect(edgeVisual(connectionFixture('b', 1, 2, { type: 'bridge' })).dash).toBe('dotted');
  });
});
