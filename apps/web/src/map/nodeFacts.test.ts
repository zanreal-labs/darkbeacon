import { describe, expect, it } from 'vitest';
import type { UniverseSystemDto } from '@darkbeacon/shared';
import { contrastRatio } from '@darkbeacon/theme-sdk';
import { connectionFixture } from '../test/fixtures';
import { DEFAULT_ZOOM, MAP_TYPE, READABLE } from './mapType';
import { classPill, exitLetters, PILL_LABELS, SECURITY_COLORS, shownSecurity } from './nodeFacts';
import { nodeNameSizers } from './node-sizers';

const sys = (extra: Partial<UniverseSystemDto>): UniverseSystemDto => ({
  id: 1,
  name: 'X',
  regionName: 'R',
  constellationName: 'C',
  security: -1,
  whClass: 3,
  statics: [],
  effect: null,
  ...extra,
});

describe('class and security pill', () => {
  it('rounds security like the game and fills it with its colour', () => {
    expect(shownSecurity(0.04)).toBe(0.1);
    expect(shownSecurity(0.449)).toBe(0.4);
    expect(classPill(sys({ whClass: 7, security: 0.946 }))).toMatchObject({ kind: 'security', label: '0.9' });
    expect(classPill(sys({ whClass: 9, security: -0.46 }))).toMatchObject({
      kind: 'security',
      label: '-0.5',
      background: SECURITY_COLORS['0.0'],
    });
    expect(classPill(sys({ whClass: 4 }))).toEqual({
      kind: 'class',
      label: 'C4',
      token: 'security-wormhole',
    });
    expect(classPill(sys({ whClass: 15 }))).toMatchObject({ label: 'Drifter' });
    expect(classPill(undefined)).toEqual({ kind: 'unknown', label: '?' });
  });

  it('keeps WCAG AA text contrast on every security colour', () => {
    for (const [step, color] of Object.entries(SECURITY_COLORS)) {
      const pill = classPill(sys({ whClass: null, security: Number(step) }));
      if (pill.kind !== 'security') throw new Error('expected a security pill');
      expect(contrastRatio(pill.color, color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lists every pill label for the node sizers', () => {
    const labels = [3, 12, 13, 15, 25].map((whClass) => classPill(sys({ whClass })).label);
    expect(labels).toEqual(['C3', 'Thera', 'C13', 'Drifter', 'Pochven']);
    for (const label of labels.slice(1)) expect(PILL_LABELS).toContain(label);
    // C1-C6 have the width of C6; security the width of -1.0 or 0.5.
    expect(PILL_LABELS).toEqual(expect.arrayContaining(['C6', '-1.0', '0.5']));
  });
});

describe('exits', () => {
  it('marks wormhole systems with statics into known space', () => {
    expect(exitLetters(1, sys({ statics: ['D845', 'U210'] }), [])).toEqual(['H', 'L']);
    expect(exitLetters(1, sys({ statics: ['O477'] }), [])).toEqual([]);
  });

  it('marks known space reached by a wormhole, not by a gate', () => {
    const lowsec = sys({ id: 30002537, whClass: 8, security: 0.34 });
    expect(exitLetters(30002537, lowsec, [connectionFixture('c', 31000001, 30002537)])).toEqual(['L']);
    expect(
      exitLetters(30002537, lowsec, [connectionFixture('g', 30002536, 30002537, { type: 'gate' })]),
    ).toEqual([]);
  });
});

describe('node size', () => {
  it('sizes by the longest names within three letters', () => {
    expect(
      nodeNameSizers(['Jita', 'Liberated Barbican', 'Tash-Murkon Prime', 'Ardishapur Prime', 'Amarr']),
    ).toEqual(['Liberated Barbican', 'Tash-Murkon Prime', 'Ardishapur Prime']);
  });

  it('opens at a zoom where every text on the canvas stays readable', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(0.85);
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(1);
    expect(MAP_TYPE.name * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.name);
    expect(MAP_TYPE.secondary * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.secondary);
    expect(MAP_TYPE.bookmark * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.secondary);
    expect(MAP_TYPE.edge * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.edge);
  });
});
