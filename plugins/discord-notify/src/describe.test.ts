import { describe, expect, it } from 'vitest';
import type { ConnectionDto, MapSystemDto, UniverseSystemDto } from '@darkbeacon/plugin-sdk';
import { builtInThemes } from '@darkbeacon/theme-sdk';
import { messageBody } from './deliver.js';
import {
  COLORS,
  connectionAdded,
  connectionChanged,
  exitsFrom,
  systemLabel,
  type MapView,
} from './describe.js';
import { inQuietHours, parseUpdate } from './settings.js';

const UNIVERSE: Record<number, Partial<UniverseSystemDto>> = {
  31000001: { name: 'J100001', whClass: 3 },
  31000002: { name: 'J100002', whClass: 5 },
  30002537: { name: 'Amamake', whClass: 8 },
  30000142: { name: 'Jita', whClass: 7 },
};
const universe = (id: number) => (UNIVERSE[id] ? ({ id, ...UNIVERSE[id] } as UniverseSystemDto) : null);

const system = (solarSystemId: number, extra: Partial<MapSystemDto> = {}): MapSystemDto =>
  ({
    mapId: 'm1',
    solarSystemId,
    position: { x: 0, y: 0 },
    customName: null,
    temporaryName: null,
    tag: null,
    status: 'unknown',
    description: '',
    labelIds: [],
    locked: false,
    visible: true,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }) as MapSystemDto;

const connection = (id: string, source: number, target: number, extra: Partial<ConnectionDto> = {}) =>
  ({
    id,
    mapId: 'm1',
    source,
    target,
    type: 'wormhole',
    timeStatus: 'normal',
    massStatus: 'fresh',
    shipSize: 'large',
    massSaved: false,
    dangerous: false,
    bubbled: 'none',
    eolAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }) as ConnectionDto;

const view = (systems: MapSystemDto[]): MapView => ({
  map: { id: 'm1', slug: 'home-chain', name: 'Home chain' },
  systems: new Map(systems.map((s) => [s.solarSystemId, s])),
  universe,
  publicUrl: 'https://beacon.example',
});

describe('what notifications say', () => {
  it('calls out a new exit to known space and links the system on the map', () => {
    const note = connectionAdded(
      view([system(31000001), system(30002537)]),
      connection('c', 31000001, 30002537),
      0,
    );
    expect(note.embed).toMatchObject({
      title: 'New exit to Amamake (LS)',
      url: 'https://beacon.example/m/home-chain?system=30002537',
      color: COLORS.exit,
    });
    const inner = connectionAdded(view([]), connection('c', 31000001, 31000002), 0);
    expect(inner.embed.title).toBe('New connection: J100001 (C3) ↔ J100002 (C5)');
  });

  it('only reports changes for the worse, once', () => {
    const v = view([]);
    const c = connection('c', 31000001, 31000002, { timeStatus: 'eol', bubbled: 'target' });
    expect(connectionChanged(v, null, c, 0).map((n) => n.embed.title)).toEqual([
      'End of life: J100001 (C3) ↔ J100002 (C5)',
      'Bubbled: J100001 (C3) ↔ J100002 (C5)',
    ]);
    const before = { timeStatus: 'eol', massStatus: 'fresh', dangerous: false, bubbled: 'target' } as const;
    expect(connectionChanged(v, before, { ...c, massStatus: 'critical' }, 0).map((n) => n.kind)).toEqual([
      'eol',
    ]);
    expect(connectionChanged(v, before, c, 0)).toEqual([]);
  });

  it('names systems with their alias and class', () => {
    expect(systemLabel(view([system(31000001, { temporaryName: 'Home' })]), 31000001)).toBe(
      'J100001 «Home» (C3)',
    );
    expect(systemLabel(view([]), 1)).toBe('System 1');
  });

  it('finds the way home: the nearest exits through visible systems', () => {
    const exits = exitsFrom(
      31000001,
      [
        connection('a', 31000001, 31000002),
        connection('b', 31000002, 30002537),
        connection('c', 31000001, 30000142),
        connection('d', 30000142, 30002537),
      ],
      new Set([31000001, 31000002, 30002537, 30000142]),
      (id) => universe(id)?.whClass,
    );
    expect(exits).toEqual([
      { systemId: 30000142, jumps: 1 },
      { systemId: 30002537, jumps: 2 },
    ]);
  });

  it('uses the map state colours of the built-in dark theme', () => {
    const dark = builtInThemes.find((t) => t.id === 'dark')!.tokens;
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    expect(hex(COLORS.eol)).toBe(dark['edge-time-eol']);
    expect(hex(COLORS.critical)).toBe(dark['edge-mass-critical']);
    expect(hex(COLORS.danger)).toBe(dark['status-hostile']);
    expect(hex(COLORS.exit)).toBe(dark['security-high']);
    expect(hex(COLORS.kill)).toBe(dark['status-occupied']);
    expect(hex(COLORS.ping)).toBe(dark['status-warning']);
    expect(hex(COLORS.arrival)).toBe(dark['status-friendly']);
    expect(hex(COLORS.connection)).toBe(dark['color-accent']);
  });

  it('mentions only when asked, and nothing else pings', () => {
    expect(messageBody({ embeds: [], mention: null }, 'Darkbeacon')).toMatchObject({
      allowed_mentions: { parse: [] },
    });
    expect(messageBody({ embeds: [], mention: { kind: 'role', roleId: '42' } }, null)).toMatchObject({
      content: '<@&42>',
      allowed_mentions: { parse: [], roles: ['42'] },
    });
  });
});

describe('settings', () => {
  it('checks updates by hand', () => {
    expect(() => parseUpdate({ target: { kind: 'webhook', url: 'https://example.com/x' } })).toThrow(
      /webhook URL/,
    );
    expect(() => parseUpdate({ mention: { kind: 'role', roleId: null, kinds: [] } })).toThrow(/role/);
    expect(() =>
      parseUpdate({ quietHours: { enabled: true, start: '23:00', end: '07:00', timeZone: 'Mars/Olympus' } }),
    ).toThrow(/time zone/);
    expect(parseUpdate({ enabled: false, target: null })).toEqual({ enabled: false, target: null });
  });

  it('knows quiet hours over midnight, in the chosen time zone', () => {
    const quiet = { enabled: true, start: '23:00', end: '07:00', timeZone: 'UTC' };
    expect(inQuietHours(quiet, Date.UTC(2026, 9, 12, 23, 30))).toBe(true);
    expect(inQuietHours(quiet, Date.UTC(2026, 9, 12, 6, 59))).toBe(true);
    expect(inQuietHours(quiet, Date.UTC(2026, 9, 12, 12, 0))).toBe(false);
    // 23:30 in Warsaw (summer time, UTC+2) is 21:30 UTC.
    expect(inQuietHours({ ...quiet, timeZone: 'Europe/Warsaw' }, Date.UTC(2026, 6, 12, 21, 30))).toBe(true);
    expect(inQuietHours({ ...quiet, enabled: false }, Date.UTC(2026, 9, 12, 23, 30))).toBe(false);
  });
});
