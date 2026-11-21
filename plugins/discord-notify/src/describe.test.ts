import { describe, expect, it } from 'vitest';
import type { ConnectionDto, MapSystemDto, UniverseSystemDto } from '@darkbeacon/plugin-sdk';
import { builtInThemes } from '@darkbeacon/theme-sdk';
import { messageBody } from './deliver.js';
import {
  COLORS,
  connectionAdded,
  connectionChanged,
  securityLabel,
  systemLabel,
  watchClosedNote,
  watchOpenedNote,
  wayHomeNote,
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

  it('names each hub of the way home with its jumps and mouth', () => {
    const v = view([system(31000001)]);
    const route = (name: string, jumps: number, space: 'high' | 'low' | 'mixed', viaEveScout = false) => ({
      hub: { solarSystemId: 1, name, security: 0.9, kind: 'map' as const, near: null },
      jumps,
      mouth: { solarSystemId: 30002537, name: 'Amamake', security: 0.4 },
      space,
      viaEveScout,
    });
    const note = wayHomeNote(
      v,
      {
        home: { solarSystemId: 31000001, name: 'J100001' },
        routes: [
          route('Jita', 7, 'high'),
          route('Amarr', 9, 'mixed', true),
          ...Array(6).fill(route('Hek', 12, 'low')),
        ],
      },
      0,
    )!;
    const lines = note.embed.description!.split('\n');
    expect(note.embed.title).toBe('Way home to J100001 (C3)');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^\*\*Jita\*\*: 7J via \[Amamake\]\(.+\) \(high-sec only\)$/);
    expect(lines[1]).toMatch(/9J via \[Amamake\]\(.+\) · through Thera\/Turnur$/);
    expect(wayHomeNote(v, { home: null, routes: [] }, 0)).toBeNull();
    expect(
      wayHomeNote(v, { home: { solarSystemId: 31000001, name: 'J100001' }, routes: [] }, 0)!.embed
        .description,
    ).toBe('No hub of the map has a way into the chain right now.');
  });

  it('says a watched way home with the gates to the mouth and the holes after it', () => {
    const v = view([system(31000001)]);
    const watch = {
      id: 'w',
      mapId: 'm1',
      accountId: 'a',
      ownerName: 'Ayla',
      target: { solarSystemId: 30002187, name: 'Amarr', security: 1 },
      maxJumps: 10,
      mode: 'shortest' as const,
      expiresAt: Date.UTC(2026, 10, 22, 18, 30),
      createdAt: 0,
      route: null,
    };
    const home = { solarSystemId: 31000001, name: 'J100001' };
    const mouth = { solarSystemId: 30002537, name: 'Amamake', security: 0.04 };
    const opened = watchOpenedNote(
      v,
      { watch, home, change: 'moved', route: { jumps: 4, gates: 1, wormholeJumps: 3, mouth } },
      0,
    );
    expect(opened).toMatchObject({ kind: 'routeWatches', ping: { accountId: 'a' } });
    expect(opened.embed.title).toBe('New way home: Amarr → J100001');
    expect(opened.embed.description).toMatch(
      /^\*\*4 jumps\*\* \(1 gate to \[Amamake\]\(.+\) \(0\.1\), 3 WH jumps\)\nWatch of Ayla, until 18:30 EVE\.$/,
    );
    const here = watchOpenedNote(
      v,
      { watch, home, change: 'again', route: { jumps: 1, gates: 0, wormholeJumps: 1, mouth } },
      0,
    );
    expect(here.ping).toBeUndefined();
    expect(here.embed.description).toMatch(/^\*\*1 jump\*\* \(the hole is in \[Amamake\]/);
    const closed = watchClosedNote(v, { watch, mouth, home }, 0);
    expect(closed.ping).toBeUndefined();
    expect(closed.embed.title).toBe('Way home closed: Amarr → J100001');
    expect([securityLabel(0.66), securityLabel(-0.2), securityLabel(0)]).toEqual(['0.7', '-0.2', '0.0']);
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
    // A member by name, once, and only real Discord ids.
    expect(
      messageBody({ embeds: [], mention: null, users: ['777', '777', '@everyone'] }, null),
    ).toMatchObject({ content: '<@777>', allowed_mentions: { parse: [], users: ['777'] } });
    expect(
      messageBody({ embeds: [], mention: { kind: 'here', roleId: null }, users: ['777'] }, null),
    ).toMatchObject({ content: '@here <@777>', allowed_mentions: { parse: ['everyone'], users: ['777'] } });
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
