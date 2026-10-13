import { describe, expect, it } from 'vitest';
import { MapViewDto, ViewPresetDto, type MapViewDto as MapView } from '@darkbeacon/shared';
import { DEFAULT_CANVAS_PREFS } from '../canvas/prefs';
import { CORE_WIDGETS, EMPTY_LAYOUT, LAYOUT_VERSION, type WidgetsLayout } from '../widgets/layout';
import {
  BUILT_IN_VIEWS,
  captureView,
  EMPTY_PERSONAL,
  findView,
  mapViews,
  parsePersonalViews,
  parseView,
  resolveSlots,
  showsView,
  toMapView,
  type PersonalViews,
  type ViewPreset,
} from './format';

const layout: WidgetsLayout = {
  version: LAYOUT_VERSION,
  visible: ['info', 'signatures'],
  boxes: { signatures: { x: 20, y: 30, w: 400, h: 300, fixed: true } },
  order: ['signatures'],
  caps: { info: 200 },
};
const preset = (visible: string[]): ViewPreset => ({
  version: 1,
  layout: { ...EMPTY_LAYOUT, visible },
  canvas: { minimap: 'off' },
});
const published = (id: string, name: string, slot?: 1 | 2 | 3): MapView =>
  toMapView(id, name, preset(['info', id]), slot, 1);

describe('the view format', () => {
  it('captures the widget layout and the canvas options that change the screen, nothing else', () => {
    const view = captureView(layout, { ...DEFAULT_CANVAS_PREFS, minimap: 'top-left', snapToGrid: false });
    expect(view).toEqual({
      version: 1,
      layout,
      canvas: { minimap: 'top-left', pings: 'top-right', background: 'dots', softBackground: false },
    });
    // What the server keeps, as the shared schema reads it.
    expect(ViewPresetDto.parse(view)).toEqual(view);
  });

  it('reads views of this version, older layouts in this version’s terms, and refuses the rest', () => {
    expect(parseView(captureView(layout, DEFAULT_CANVAS_PREFS))?.layout).toEqual(layout);
    // A layout kept before the column: the widgets stay, the windows go back to it.
    const old = parseView({
      version: 1,
      layout: { visible: ['local'], boxes: { local: { x: 1, y: 2, w: 3, h: 4 } }, order: [] },
      canvas: {},
    });
    expect(old?.layout).toEqual({ version: LAYOUT_VERSION, visible: ['local'], boxes: {}, order: [] });
    // Unknown or invalid canvas options are left out.
    expect(
      parseView({ version: 1, layout, canvas: { minimap: 'middle', background: 'lines', fog: true } })
        ?.canvas,
    ).toEqual({
      background: 'lines',
    });
    expect(parseView({ version: 2, layout, canvas: {} })).toBeNull();
    expect(parseView({ version: 1, layout: { visible: 3 }, canvas: {} })).toBeNull();
    expect(parseView(null)).toBeNull();
  });

  it('reads my views and pins from my preferences, leaving out what it cannot read', () => {
    expect(parsePersonalViews(undefined)).toEqual(EMPTY_PERSONAL);
    const mine = parsePersonalViews({
      version: 1,
      views: [
        { id: 'p1', name: 'Mine', view: preset(['local']), updatedAt: 5 },
        { id: 'p2', name: 'Broken', view: { version: 7 } },
      ],
      pins: {
        m1: {
          '1': { source: 'personal', id: 'p1' },
          '4': { source: 'map', id: 'x' },
          '2': { source: 'nope', id: 'y' },
        },
      },
    });
    expect(mine.views.map((v) => v.id)).toEqual(['p1']);
    expect(mine.pins).toEqual({ m1: { '1': { source: 'personal', id: 'p1' } } });
  });

  it('builds the built-in views from widgets that exist', () => {
    const ids = new Set<string>(CORE_WIDGETS.map((w) => w.id));
    expect(BUILT_IN_VIEWS.map((v) => v.name)).toEqual(['Scan', 'PvP', 'Nav']);
    for (const v of BUILT_IN_VIEWS) {
      expect(
        v.view.layout.visible!.every((id) => ids.has(id)),
        v.name,
      ).toBe(true);
      expect(ViewPresetDto.safeParse(v.view).success, v.name).toBe(true);
    }
    expect(BUILT_IN_VIEWS[0]!.view.layout.visible).toEqual(['info', 'signatures', 'local']);
    expect(BUILT_IN_VIEWS[1]!.view.layout.visible).toEqual(['info', 'local', 'kills']);
    expect(BUILT_IN_VIEWS[2]!.view.layout.visible).toEqual(['info', 'routes', 'connections']);
  });

  it('keeps the map’s published views it can read, with their slots', () => {
    const list = [
      published('a', 'Fleet', 2),
      { ...published('b', 'Future'), view: { version: 1 } } as unknown as MapView,
    ];
    expect(mapViews(list).map((v) => [v.source, v.id, v.slot])).toEqual([['map', 'a', 2]]);
    expect(MapViewDto.safeParse(published('a', 'Fleet', 2)).success).toBe(true);
  });
});

describe('quick slots', () => {
  const map = mapViews([published('fleet', 'Fleet', 1), published('roll', 'Rolling')]);
  const mine: PersonalViews = {
    version: 1,
    views: [{ id: 'p1', name: 'Mine', view: preset(['local']), updatedAt: 1 }],
    pins: {},
  };
  const names = (personal: PersonalViews, list = map, mapId = 'm1') =>
    resolveSlots(mapId, personal, list).map((s) => [s.slot, s.view.name, s.pinned]);

  it('fall back to the built-in views on a map that published none', () => {
    expect(names(EMPTY_PERSONAL, [])).toEqual([
      [1, 'Scan', false],
      [2, 'PvP', false],
      [3, 'Nav', false],
    ]);
  });

  it('take the map’s default for a slot over the built-in one', () => {
    expect(names(EMPTY_PERSONAL)).toEqual([
      [1, 'Fleet', false],
      [2, 'PvP', false],
      [3, 'Nav', false],
    ]);
  });

  it('take my own pin over the map’s default, on that map only, and fall back when it is gone', () => {
    const pinned: PersonalViews = {
      ...mine,
      pins: {
        m1: { '1': { source: 'personal', id: 'p1' }, '3': { source: 'map', id: 'roll' } },
      },
    };
    expect(names(pinned)).toEqual([
      [1, 'Mine', true],
      [2, 'PvP', false],
      [3, 'Rolling', true],
    ]);
    expect(names(pinned, map, 'm2')).toEqual([
      [1, 'Fleet', false],
      [2, 'PvP', false],
      [3, 'Nav', false],
    ]);
    // My view deleted, the map's view unpublished: the defaults again.
    expect(names({ ...pinned, views: [] }, mapViews([published('fleet', 'Fleet', 1)]))).toEqual([
      [1, 'Fleet', false],
      [2, 'PvP', false],
      [3, 'Nav', false],
    ]);
    expect(findView({ source: 'builtin', id: 'nav' }, mine, map)?.name).toBe('Nav');
    expect(findView({ source: 'personal', id: 'gone' }, mine, map)).toBeNull();
  });

  it('know the screen still shows a view whatever window is in front, until it changes', () => {
    const view = captureView(layout, DEFAULT_CANVAS_PREFS);
    expect(showsView(view, { ...layout, order: ['info', 'signatures'] }, DEFAULT_CANVAS_PREFS)).toBe(true);
    expect(showsView(view, { ...layout, caps: {} }, DEFAULT_CANVAS_PREFS)).toBe(false);
    expect(showsView(view, layout, { ...DEFAULT_CANVAS_PREFS, background: 'none' })).toBe(false);
    // Options a view leaves out do not count.
    const scan = BUILT_IN_VIEWS[0]!.view;
    expect(showsView(scan, scan.layout, { ...DEFAULT_CANVAS_PREFS, minimap: 'off' })).toBe(true);
  });
});
