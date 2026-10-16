import { describe, expect, it } from 'vitest';
import type { MapExitDto, UniverseSystemDto } from '@darkbeacon/shared';
import { contrastRatio, darkTheme, lightTheme } from '@darkbeacon/theme-sdk';
import { DEFAULT_ZOOM, MAP_TYPE, READABLE } from './mapType';
import {
  classPill,
  exitChips,
  exitHubs,
  nearestHubTitle,
  nodeTint,
  ROUTE_SPACE_COLOR,
  SECURITY_COLORS,
  shownSecurity,
} from './nodeFacts';

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

  it('names wormhole classes and special space on the pill', () => {
    const labels = [3, 12, 13, 15, 25].map((whClass) => classPill(sys({ whClass })).label);
    expect(labels).toEqual(['C3', 'Thera', 'C13', 'Drifter', 'Pochven']);
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
    expect([...hubs]).toEqual([[30002537, { name: 'Jita', jumps: 4, space: 'low', rules: 'viewer' }]]);
    expect(exitHubs(null).size).toBe(0);
  });

  it("shows the jumps the viewer's Routes widget shows from the exit, not the map-wide ones", () => {
    // The report: Routes said Dodixie 19 (through a Turnur hole EVE-Scout lists), the chip under
    // the same exit said 44 - it showed the map-wide exits, routed without EVE-Scout holes.
    const dodixie = {
      solarSystemId: 30002659,
      name: 'Dodixie',
      security: 0.87,
      kind: 'trade' as const,
      near: null,
    };
    const shared = [exit({ nearest: { ...dodixie, jumps: 44, space: 'mixed' } })];
    const viewer = [exit({ nearest: { ...dodixie, jumps: 19, space: 'mixed' } })];
    const chip = exitChips(viewer, shared, false).get(30002537)!;
    expect(chip).toMatchObject({ name: 'Dodixie', jumps: 19, rules: 'viewer' });
    expect(nearestHubTitle(chip, 'Amamake')).toBe(
      'Nearest hub: Dodixie, 19 jumps from Amamake, through mixed space; with your route options, as the Routes widget routes from here',
    );
    // Until the viewer's own exits load, no chip rather than one the widget would contradict.
    expect(exitChips(undefined, shared, false).size).toBe(0);
    // Where they cannot be had (a public view, a failed request) the map-wide ones say what they are.
    const fallback = exitChips(undefined, shared, true).get(30002537)!;
    expect(fallback).toMatchObject({ jumps: 44, rules: 'shared' });
    expect(nearestHubTitle(fallback, 'Amamake')).toMatch(/shortest way, without Thera and Turnur holes/);
  });

  it('colours the route space square in the game palette, not a theme colour', () => {
    expect(ROUTE_SPACE_COLOR).toEqual({
      high: SECURITY_COLORS['0.8'],
      low: SECURITY_COLORS['0.4'],
      null: SECURITY_COLORS['0.0'],
    });
  });
});

describe('node size', () => {
  it('opens at a zoom where every text on the canvas stays readable', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(0.85);
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(1);
    expect(MAP_TYPE.name * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.name);
    expect(MAP_TYPE.secondary * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.secondary);
    expect(MAP_TYPE.bookmark * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.secondary);
    expect(MAP_TYPE.edge * DEFAULT_ZOOM).toBeGreaterThanOrEqual(READABLE.edge);
  });
});

describe('node tint', () => {
  it("tints an unmarked system with the game colour of the holder's standing, never with a status", () => {
    expect(nodeTint('unknown', 10)).toMatchObject({ by: 'standing', tone: 'excellent' });
    expect(nodeTint('unknown', 5)).toMatchObject({ by: 'standing', tone: 'good' });
    expect(nodeTint('unknown', -5)).toMatchObject({ by: 'standing', tone: 'bad' });
    expect(nodeTint('unknown', -10)).toMatchObject({ by: 'standing', tone: 'terrible' });
    expect(nodeTint('unknown', 10).image).toContain(
      'var(--dbk-standing-excellent) var(--dbk-node-tint-standing)',
    );
    expect(nodeTint('unknown', 10).image).not.toContain('status-friendly');
    for (const neutral of [0, null, undefined]) {
      expect(nodeTint('unknown', neutral)).toEqual({ image: 'none', by: null });
    }
  });

  it('lets every status someone set win, friendly included', () => {
    for (const status of ['home', 'friendly', 'empty', 'occupied', 'warning', 'hostile', 'target'] as const) {
      const tint = nodeTint(status, 10);
      expect(tint.by).toBe('status');
      expect(tint.image).toContain(`var(--dbk-status-${status})`);
    }
  });
});
