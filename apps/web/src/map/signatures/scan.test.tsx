// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { signatureFixture } from '../../test/fixtures';
import {
  isIdentifiedWormhole,
  SCAN_COLOR_VARS,
  SCAN_COLORS,
  scanColor,
  scanTitle,
  strengthColor,
  WORMHOLE_COLOR,
} from './scan';

const SYSTEM = 31000001;

describe('scan colours', () => {
  it('bands a signal strength as the probe scanner does', () => {
    expect([0, 24.9, 25, 74.9, 75, 99.9, 100].map(strengthColor)).toEqual([
      'red',
      'red',
      'orange',
      'orange',
      'yellow',
      'yellow',
      'green',
    ]);
  });

  it('tells how far a result was scanned from what is known of it', () => {
    const sig = (extra: Parameters<typeof signatureFixture>[3]) =>
      scanColor(signatureFixture('s', SYSTEM, 'ABC-123', extra));
    // Not even the group: under 25 %.
    expect(sig({})).toBe('red');
    // The group without a name (or, for a hole, a type or a link): under 75 %.
    expect(sig({ group: 'data' })).toBe('orange');
    expect(sig({ group: 'wormhole' })).toBe('orange');
    // Named, typed or linked: scanned down.
    expect(sig({ group: 'data', name: 'Unsecured Frontier Database' })).toBe('green');
    expect(sig({ group: 'wormhole', type: 'D845' })).toBe('green');
    expect(sig({ group: 'wormhole', connectionId: 'c1' })).toBe('green');
    // Anomalies are at 100 % from the first sweep; ships and structures have no scan state.
    expect(sig({ kind: 'anomaly', group: 'combat' })).toBe('green');
    expect(sig({ kind: 'other', type: 'Ship · Frigate' })).toBeNull();
    expect(scanTitle(signatureFixture('s', SYSTEM, 'ABC-123', { kind: 'anomaly' }))).toMatch(/no probing/);
  });

  it('gives fixed hex, the game hue on dark themes and a darker one on light', () => {
    expect(SCAN_COLOR_VARS).toMatchObject({
      '--scan-red': `light-dark(${SCAN_COLORS.red.light}, ${SCAN_COLORS.red.game})`,
      '--scan-green': `light-dark(${SCAN_COLORS.green.light}, ${SCAN_COLORS.green.game})`,
    });
    for (const c of Object.values(SCAN_COLORS)) {
      expect(c.game).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.light).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('sets identified wormholes apart from sites in their own colour, unscanned results stay red', () => {
    const sig = (extra: Parameters<typeof signatureFixture>[3]) =>
      signatureFixture('s', SYSTEM, 'ABC-123', extra);
    expect(isIdentifiedWormhole(sig({ group: 'wormhole' }))).toBe(true);
    expect(isIdentifiedWormhole(sig({ group: 'wormhole', type: 'H296' }))).toBe(true);
    // Scanned down to the same green as a site, but still a wormhole.
    expect(scanColor(sig({ group: 'wormhole', type: 'H296' }))).toBe(
      scanColor(sig({ group: 'data', name: 'x' })),
    );
    expect(isIdentifiedWormhole(sig({}))).toBe(false);
    expect(scanColor(sig({}))).toBe('red');
    expect(isIdentifiedWormhole(sig({ group: 'data', name: 'Unsecured Frontier Database' }))).toBe(false);
    expect(isIdentifiedWormhole(sig({ kind: 'anomaly', group: 'combat' }))).toBe(false);
    expect(SCAN_COLOR_VARS).toMatchObject({
      '--scan-wormhole': `light-dark(${WORMHOLE_COLOR.light}, ${WORMHOLE_COLOR.game})`,
    });
    // Clear of every scan colour.
    for (const c of Object.values(SCAN_COLORS)) {
      expect(c.game).not.toBe(WORMHOLE_COLOR.game);
      expect(c.light).not.toBe(WORMHOLE_COLOR.light);
    }
  });
});
