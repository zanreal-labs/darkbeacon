// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { signatureFixture } from '../../test/fixtures';
import { SCAN_COLOR_VARS, SCAN_COLORS, ScanMark, scanColor, scanTitle, strengthColor } from './scan';

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

  it('draws a circle for a signature, a diamond for an anomaly, nothing for other results', () => {
    const mark = (extra: Parameters<typeof signatureFixture>[3]) =>
      render(<ScanMark signature={signatureFixture('s', SYSTEM, 'ABC-123', extra)} />).container;
    const signature = mark({ group: 'gas' }).querySelector('svg')!;
    expect(signature.getAttribute('data-kind')).toBe('signature');
    expect(signature.querySelector('circle')).toBeTruthy();
    const anomaly = mark({ kind: 'anomaly', group: 'ore' }).querySelector('svg')!;
    expect(anomaly.getAttribute('data-kind')).toBe('anomaly');
    expect(anomaly.querySelector('circle')).toBeNull();
    expect(mark({ kind: 'other' }).querySelector('svg')).toBeNull();
  });
});
