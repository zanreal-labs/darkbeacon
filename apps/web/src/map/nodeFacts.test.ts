import { describe, expect, it } from 'vitest';
import type { MapExitDto, UniverseSystemDto } from '@darkbeacon/shared';
import { contrastRatio, darkTheme, lightTheme } from '@darkbeacon/theme-sdk';
import { DEFAULT_ZOOM, MAP_TYPE, READABLE } from './mapType';
import { classPill, exitHubs, PILL_LABELS, SECURITY_COLORS, shownSecurity } from './nodeFacts';
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
      token: 'pill-wormhole',
    });
    expect(classPill(sys({ whClass: 15 }))).toMatchObject({ label: 'Drifter' });
    expect(classPill(undefined)).toEqual({ kind: 'unknown', label: '?' });
  });

  it('keeps the bold dark pill text readable on every game security colour', () => {
    const pillText = lightTheme.tokens['node-pill-text'];
    expect(darkTheme.tokens['node-pill-text']).toBe(pillText);
    for (const [step, color] of Object.entries(SECURITY_COLORS)) {
      const pill = classPill(sys({ whClass: null, security: Number(step) }));
      if (pill.kind !== 'security') throw new Error('expected a security pill');
      expect(pill.background).toBe(color);
      // The colours are the game's, not ours to lighten: the deepest reds (0.1, 0.0) sit at ~4:1,
      // which the pill's bold text carries.
      expect(contrastRatio(pillText, color)).toBeGreaterThanOrEqual(4);
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

describe('exit hubs', () => {
  const exit = (extra: Partial<MapExitDto>): MapExitDto => ({
    kind: 'connected',
    solarSystemId: 30002537,
    name: 'Amamake',
    security: 0.38,
    whClass: 8,
    classLabel: 'LS',
    connectionId: 'c',
    chainSystemId: 31000001,
    statics: [],
    nearest: null,
    hubs: [],
    ...extra,
  });
  const jita = { solarSystemId: 30000142, name: 'Jita', security: 0.95, kind: 'trade' as const, near: null };

  it('takes the nearest hub of connected exits from the routing API', () => {
    const hubs = exitHubs([
      exit({ nearest: { ...jita, jumps: 4, space: 'low' } }),
      exit({ solarSystemId: 2, nearest: { ...jita, jumps: null } }),
      exit({ solarSystemId: 3, kind: 'static', statics: [{ code: 'D845', destination: 'hs' }] }),
    ]);
    expect([...hubs]).toEqual([[30002537, { name: 'Jita', jumps: 4, space: 'low' }]]);
    expect(exitHubs(null).size).toBe(0);
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
