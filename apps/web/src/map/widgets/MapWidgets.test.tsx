// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { http, HttpResponse } from 'msw/http';
import {
  buildPath,
  routes,
  type CharacterPresenceDto,
  type KillmailDto,
  type MapDto,
  type MapSystemDto,
  type SystemActivityDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import { MapView } from '../../screens/MapView';
import { connectionFixture, MAP_ID, meFixture, signatureFixture, systemFixture } from '../../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { emptyMapState, type MapState } from '../mapState';
import { useMapStore } from '../useMapStore';
import {
  clampBox,
  DEFAULT_VISIBLE,
  DOCK_GAP,
  dockColumn,
  dockWidth,
  EMPTY_LAYOUT,
  fromStored,
  GUTTER,
  LAYOUT_KEY,
  LAYOUT_VERSION,
  migrateSidebarLayout,
  MIN_SIZE,
  moveBox,
  parseLayout,
  resizeBox,
  resizeDocked,
  resolveBoxes,
  toStored,
  type WidgetsLayout,
} from './layout';
import { EditSystemDialog } from './EditSystemDialog';
import { MapWidgets } from './MapWidgets';
import { useWidgetsLayout } from './useWidgetsLayout';
import win from './window.module.css';

installFlowMocks();

const WH = 31000001;
const JITA = 30000142;
const universe: Record<number, UniverseSystemDto> = {
  [WH]: {
    id: WH,
    name: 'J100001',
    regionName: 'A-R00001',
    constellationName: 'A-C00311',
    security: -0.99,
    whClass: 3,
    statics: ['D845'],
    effect: 'pulsar',
  },
  [JITA]: {
    id: JITA,
    name: 'Jita',
    regionName: 'The Forge',
    constellationName: 'Kimotoro',
    security: 0.946,
    whClass: 7,
    statics: [],
    effect: null,
  },
};
const me = meFixture();
const pilot = (id: number, name: string, solarSystemId: number): CharacterPresenceDto => ({
  characterId: id,
  accountId: 'acc',
  name,
  solarSystemId,
  shipTypeId: 11567,
  shipName: `${name}'s Loki`,
  online: true,
  updatedAt: 1,
});
const pilots = [
  pilot(me.characters[0]!.id, me.characters[0]!.name, WH),
  pilot(95_000_001, 'Hostile Guy', WH),
];

const server = setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(me)),
  http.get(routes.universe.getSystem.path, ({ params }) =>
    HttpResponse.json(universe[Number(params.solarSystemId)]),
  ),
  http.get(routes.connections.intel.path, () => HttpResponse.json([])),
  http.get(routes.maps.getPreferences.path, () =>
    HttpResponse.json({ viewport: null, bookmarkTemplate: null, updatedAt: 0 }),
  ),
  http.get(routes.tracking.characters.path, () => HttpResponse.json(pilots)),
  http.get(routes.maps.get.path, () => HttpResponse.json(mapDto)),
  http.get(routes.intel.map.path, () => HttpResponse.json({ systems: [], live: true })),
  http.get(routes.intel.standings.path, () =>
    HttpResponse.json({ standings: [], missingScopes: false, overrides: [] }),
  ),
  http.get(routes.characters.mapSettings.path, () =>
    HttpResponse.json({ mainCharacterId: null, followCharacterId: null }),
  ),
  http.get(routes.routing.hubs.path, () => HttpResponse.json({ trade: [], map: [], personal: [] })),
  http.get(routes.intel.system.path, () => HttpResponse.json(activityFixture())),
  http.get(routes.intel.kills.path, ({ request }) => {
    const all = !new URL(request.url).searchParams.has('systems');
    return HttpResponse.json({
      kills: all ? [killFixture(1, WH), killFixture(2, JITA)] : [killFixture(1, WH)],
    });
  }),
);

function killFixture(id: number, solarSystemId: number): KillmailDto {
  return {
    id,
    solarSystemId,
    time: Date.now() - 12 * 60_000,
    value: 1_250_000_000,
    npc: false,
    solo: false,
    victim: {
      character: { id: 90000001, name: 'Unlucky Pilot', ticker: null },
      corporation: { id: 98000001, name: 'Victim Corp', ticker: 'VIC' },
      alliance: null,
      ship: { id: 11987, name: 'Guardian', ticker: null },
    },
    finalBlow: null,
    attackerCount: 4,
    attackers: [
      {
        corporation: { id: 98000002, name: 'Hunters', ticker: 'HUNT' },
        alliance: { id: 99000002, name: 'Hunting Party', ticker: 'HPTY' },
        pilots: 3,
      },
    ],
  };
}

function activityFixture(): SystemActivityDto {
  const hour = Date.UTC(2026, 9, 12, 13);
  return {
    intel: {
      solarSystemId: WH,
      sovereignty: null,
      regionHolder: null,
      kills1h: 6,
      npcKills1h: null,
      jumps1h: null,
      lastKillAt: Date.now(),
    },
    hours: Array.from({ length: 24 }, (_, i) => ({
      hour: hour - (23 - i) * 3_600_000,
      shipKills: null,
      podKills: null,
      npcKills: null,
      jumps: null,
      killmails: i === 23 ? 6 : 0,
    })),
    kills: [killFixture(1, WH)],
    groups: {
      '1h': [
        {
          kind: 'alliance',
          entity: { id: 99000002, name: 'Hunting Party', ticker: 'HPTY' },
          kills: 1,
          losses: 0,
        },
      ],
      '24h': [
        {
          kind: 'alliance',
          entity: { id: 99000002, name: 'Hunting Party', ticker: 'HPTY' },
          kills: 4,
          losses: 1,
        },
        {
          kind: 'corporation',
          entity: { id: 98000001, name: 'Victim Corp', ticker: 'VIC' },
          kills: 0,
          losses: 3,
        },
      ],
      '7d': [
        {
          kind: 'alliance',
          entity: { id: 99000002, name: 'Hunting Party', ticker: 'HPTY' },
          kills: 9,
          losses: 1,
        },
        {
          kind: 'corporation',
          entity: { id: 98000001, name: 'Victim Corp', ticker: 'VIC' },
          kills: 0,
          losses: 3,
        },
      ],
    },
    coveredSince: 0,
  };
}

const mapDto: MapDto = {
  id: MAP_ID,
  slug: 'home',
  name: 'Home',
  ownerAccountId: 'acc',
  settings: { scopes: ['wormhole'] },
  labels: [{ id: 'l1', name: 'Staging', color: '#3b82f6', description: '' }],
  systemLabels: [
    { id: 'wh1', name: 'WH1', description: '' },
    { id: 'wh2', name: 'WH2', description: 'Second hole' },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const wrap = (ui: ReactElement) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
  );

/** A matchMedia that answers the phone query as told. */
function screenWidth(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** The size jsdom gives the widgets' layer (it lays nothing out): a 1440x900 screen below the top bar. */
const AREA = { width: 1440, height: 848 };
const layerSize = (key: 'width' | 'height') =>
  function (this: HTMLElement) {
    return this.dataset?.widgetsLayer !== undefined ? AREA[key] : 0;
  };
/** jsdom lays nothing out either: every title bar is 26 px, every window's content 120 px. */
const CONTENT = 120;
const TITLE = 26;
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: { configurable: true, get: layerSize('width') },
  clientHeight: { configurable: true, get: layerSize('height') },
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset?.widgetContent !== undefined) return CONTENT;
      if (this.tagName === 'HEADER') return TITLE;
      return 0;
    },
  },
});

beforeEach(() => {
  window.localStorage.clear();
  screenWidth(false);
});
afterEach(() => vi.restoreAllMocks());

const region = (name: string) => screen.getByRole('region', { name });
const storedLayout = () =>
  JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? 'null') as WidgetsLayout | null;

describe('the map view', () => {
  const snapshot: StreamSnapshotDto = {
    stream: `map:${MAP_ID}`,
    seq: 1,
    data: {
      systems: [
        systemFixture(WH, { position: { x: 0, y: 0 } }),
        systemFixture(JITA, { position: { x: 400, y: 0 } }),
      ],
      connections: [],
      signatures: [signatureFixture('s1', WH, 'ABC-123', { group: 'wormhole', type: 'D845' })],
    },
  };

  const view = () =>
    wrap(
      <ReactFlowProvider>
        <div style={{ width: 1200, height: 800 }}>
          <MapView map={mapDto} role="member" snapshot={snapshot} />
        </div>
      </ReactFlowProvider>,
    );

  const node = async (id: number) => {
    await waitFor(() => expect(document.querySelector(`.react-flow__node[data-id="${id}"]`)).toBeTruthy());
    return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  };

  it('shows no widget while nothing is selected, and the selected system’s once one is', async () => {
    view();
    await node(WH);
    // The map has the whole canvas: no windows, no empty boxes.
    for (const name of ['System info', 'Signatures', 'Local', 'Routes', 'Kills'])
      expect(screen.queryByRole('region', { name })).toBeNull();
    expect(screen.queryByText('No system selected')).toBeNull();

    // A plain click: d3-drag reads `event.view` on mousedown, which jsdom leaves empty.
    fireEvent.click(await node(WH));
    expect(await within(region('System info')).findByRole('heading', { name: 'J100001' })).toBeTruthy();
    expect(within(region('Signatures')).getByText('ABC-123')).toBeTruthy();
    expect(await within(region('Local')).findByText('Hostile Guy')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('opens Edit system from the context menu’s Edit… and from a double-click on the system', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.contextMenu(await node(WH));
    const items = await screen.findAllByRole('menuitem');
    // Edit… comes first.
    expect(items[0]!.textContent).toContain('Edit…');
    await user.click(items[0]!);
    const dialog = await screen.findByRole('dialog', { name: /Edit system/ });
    expect(within(dialog).getByRole('textbox', { name: 'Custom name' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeTruthy();
    // The footer's Close (the X in the corner is called Close too).
    await user.click(
      within(dialog)
        .getAllByRole('button', { name: 'Close' })
        .find((b) => b.textContent === 'Close')!,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.doubleClick(await node(JITA));
    const again = await screen.findByRole('dialog', { name: /Edit system/ });
    expect(within(again).getByRole('heading', { name: /Jita/ })).toBeTruthy();
  });

  it('shows and hides widgets from the top bar’s menu, and resets the layout', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.click(await node(WH));
    await screen.findByRole('region', { name: 'System info' });
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Structures' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Kills' }));
    await user.keyboard('{Escape}');
    expect(region('Structures')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Kills' })).toBeNull();
    // Turned on, it joins the column.
    const layout = storedLayout()!;
    expect(layout.visible).toEqual(['info', 'signatures', 'local', 'routes', 'structures']);
    expect(layout.boxes).toEqual({});
    expect(region('Structures').dataset.docked).toBe('true');

    // All of them away for a moment, and back.
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show widgets' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Signatures' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset layout' }));
    for (const name of ['System info', 'Signatures', 'Local', 'Routes', 'Kills'])
      expect(region(name)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Structures' })).toBeNull();
    expect(storedLayout()).toEqual(EMPTY_LAYOUT);
  });
});

function Widgets({
  state,
  solarSystemId = WH,
  system,
  selected = true,
}: {
  state: Partial<MapState>;
  solarSystemId?: number;
  system?: Partial<MapSystemDto>;
  selected?: boolean;
}) {
  const store = useMapStore(MAP_ID);
  const controller = useWidgetsLayout();
  const full = { ...emptyMapState(), has: { signatures: true, characters: true }, ...state };
  return (
    <div style={{ position: 'relative', height: 900 }}>
      <MapWidgets
        mapId={MAP_ID}
        system={selected ? systemFixture(solarSystemId, system) : undefined}
        info={universe[solarSystemId]}
        universe={new Map(Object.values(universe).map((u) => [u.id, u]))}
        labels={mapDto.labels}
        systemLabels={mapDto.systemLabels}
        state={full}
        can={mapPermissions('member')}
        store={store}
        myCharacters={me.characters}
        plugins={[]}
        controller={controller}
        shown
        onSelectSystem={() => {}}
        onCover={() => {}}
      />
    </div>
  );
}

const windowBox = (name: string) => {
  const el = region(name);
  return {
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height),
  };
};

describe('widget windows', () => {
  const NAMES = ['System info', 'Signatures', 'Local', 'Routes', 'Kills'];

  it('stand in one narrow column against the right edge, as tall as their content, 8 px apart', () => {
    wrap(<Widgets state={{}} />);
    const boxes = NAMES.map(windowBox);
    const width = dockWidth(AREA);
    expect(width).toBe(360);
    let y = GUTTER;
    for (const [i, box] of boxes.entries()) {
      expect(box.x + box.w).toBe(AREA.width - GUTTER);
      expect(box.w).toBe(width);
      expect(box.y).toBe(y);
      // The title bar and the content, nothing more.
      expect(box.h).toBe(TITLE + CONTENT);
      expect(region(NAMES[i]!).dataset.docked).toBe('true');
      y += box.h + DOCK_GAP;
    }
  });

  it('floats where its title bar is dragged and stays there; the column closes up', () => {
    const first = wrap(<Widgets state={{}} />);
    const sigs = windowBox('Signatures');
    const local = windowBox('Local');
    const title = region('Signatures').querySelector('header')!;
    fireEvent.pointerDown(title, { button: 0, clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(title, { clientX: 300, clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(title, { pointerId: 1 });
    const moved = windowBox('Signatures');
    expect(moved).toMatchObject({ x: sigs.x - 200, y: sigs.y + 40, h: sigs.h });
    expect(region('Signatures').dataset.docked).toBeUndefined();
    expect(storedLayout()!.boxes.signatures).toBeTruthy();
    // Local moves up into the place Signatures left.
    expect(windowBox('Local').y).toBe(sigs.y);
    expect(local.y).toBeGreaterThan(sigs.y);
    first.unmount();

    wrap(<Widgets state={{}} />);
    expect(windowBox('Signatures')).toEqual(moved);
  });

  it('keeps a docked window in the column when resized: the height becomes its cap', () => {
    wrap(<Widgets state={{}} />);
    const local = windowBox('Local');
    const corner = region('Local').querySelector<HTMLElement>('[data-corner="se"]')!;
    fireEvent.pointerDown(corner, { button: 0, clientX: 0, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(corner, { clientX: 0, clientY: -60, pointerId: 2 });
    fireEvent.pointerUp(corner, { pointerId: 2 });
    expect(storedLayout()!.caps).toEqual({ local: local.h - 60 });
    expect(windowBox('Local')).toEqual({ ...local, h: local.h - 60 });
    expect(region('Local').dataset.docked).toBe('true');
    // The windows under it close up.
    expect(windowBox('Routes').y).toBe(local.y + local.h - 60 + DOCK_GAP);
  });

  it('is a focusable, labelled region the arrow keys move out of the column and, with Shift, resize', () => {
    wrap(<Widgets state={{}} />);
    const local = region('Local');
    const before = windowBox('Local');
    act(() => local.focus());
    expect(document.activeElement).toBe(local);
    expect(local.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.keyDown(local, { key: 'ArrowLeft' });
    expect(windowBox('Local')).toEqual({ ...before, x: before.x - 10 });
    fireEvent.keyDown(local, { key: 'ArrowUp', shiftKey: true });
    expect(windowBox('Local')).toEqual({ ...before, x: before.x - 10, h: before.h - 10 });
  });

  it('comes to the front when touched', () => {
    wrap(<Widgets state={{}} />);
    fireEvent.pointerDown(region('Routes'));
    const z = (name: string) => Number(region(name).style.zIndex);
    expect(z('Routes')).toBeGreaterThan(z('Signatures'));
    fireEvent.pointerDown(region('Signatures'));
    expect(z('Signatures')).toBeGreaterThan(z('Routes'));
  });

  it('shows nothing at all while no system is selected', () => {
    wrap(<Widgets state={{}} selected={false} />);
    for (const name of NAMES) expect(screen.queryByRole('region', { name })).toBeNull();
    expect(screen.queryByText('No system selected')).toBeNull();
  });

  it('says an empty list in one line', () => {
    wrap(<Widgets state={{}} />);
    expect(within(region('Local')).getByText('No pilots')).toBeTruthy();
    expect(within(region('Signatures')).getByText(/No signatures/)).toBeTruthy();
  });

  it('is a dock with one sheet at a time on phones, as in Wanderer, and nothing without a system', async () => {
    screenWidth(true);
    const user = userEvent.setup();
    const none = wrap(<Widgets state={{}} selected={false} />);
    expect(screen.queryByRole('list', { name: 'Widgets' })).toBeNull();
    none.unmount();
    wrap(
      <Widgets
        state={{
          signatures: new Map(
            [signatureFixture('s1', WH, 'ABC-123'), signatureFixture('s2', WH, 'DEF-456')].map((s) => [
              s.id,
              s,
            ]),
          ),
        }}
      />,
    );
    const dock = screen.getByRole('list', { name: 'Widgets' });
    const labels = within(dock)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels.slice(0, 4)).toEqual(['System info', 'Signatures 2', 'Local 0', 'Routes']);
    expect(labels[4]).toMatch(/^Kills/);
    expect(screen.queryByRole('region', { name: 'Signatures' })).toBeNull();

    await user.click(within(dock).getByRole('button', { name: 'Signatures 2' }));
    const sheet = region('Signatures');
    expect(within(sheet).getByText('ABC-123')).toBeTruthy();
    // Phones always have the paste field.
    expect(within(sheet).getByRole('textbox', { name: 'Paste probe scanner results' })).toBeTruthy();
    await user.click(within(dock).getByRole('button', { name: 'Local 0' }));
    expect(screen.queryByRole('region', { name: 'Signatures' })).toBeNull();
    await user.click(within(region('Local')).getByRole('button', { name: 'Close Local' }));
    expect(screen.queryByRole('region', { name: 'Local' })).toBeNull();
  });
});

describe('the widgets', () => {
  it('System info carries the system: pill, place, class, effect, statics and links out', async () => {
    wrap(<Widgets state={{}} />);
    const info = region('System info');
    expect(info.textContent).toContain('C3');
    // A wormhole's region and constellation codes are not shown.
    expect(info.textContent).not.toContain('A-R00001');
    expect(info.textContent).toContain('Class 3 wormhole');
    const effect = screen.getByLabelText(/^Pulsar: /);
    // Its tooltip lists what it changes in this class.
    act(() => effect.focus());
    expect((await screen.findAllByText('Shield capacity'))[0]!.nextElementSibling?.textContent).toBe('+58%');
    expect(
      within(screen.getByRole('list', { name: 'Statics' })).getByText('D845').nextSibling?.textContent,
    ).toBe('HS');
    expect(screen.getByRole('link', { name: 'zKillboard' }).getAttribute('href')).toBe(
      `https://zkillboard.com/system/${WH}/`,
    );
    expect(screen.getByRole('link', { name: 'Anoikis' }).getAttribute('href')).toBe(
      'https://anoik.is/systems/J100001',
    );
  });

  it('System info shows known space with its security and no Anoikis link', () => {
    wrap(<Widgets state={{}} solarSystemId={JITA} />);
    expect(region('System info').textContent).toContain('High-sec 0.95');
    expect(screen.getByRole('link', { name: 'Dotlan' }).getAttribute('href')).toBe(
      'https://evemaps.dotlan.net/system/Jita',
    );
    expect(screen.queryByRole('link', { name: 'Anoikis' })).toBeNull();
  });

  it('sums each widget up in its title bar, and nothing appears twice', async () => {
    const signatures = [
      signatureFixture('s1', WH, 'ABC-123', { group: 'wormhole', type: 'D845' }),
      signatureFixture('s2', WH, 'DEF-456'),
      signatureFixture('s3', WH, 'GHI-789'),
      signatureFixture('s4', WH, 'JKL-012', { kind: 'anomaly', group: 'combat' }),
    ];
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ ...EMPTY_LAYOUT, visible: [...DEFAULT_VISIBLE, 'connections'] }),
    );
    const connections = [connectionFixture('c1', WH, JITA, { timeStatus: 'eol', massStatus: 'critical' })];
    wrap(
      <Widgets
        state={{
          signatures: new Map(signatures.map((s) => [s.id, s])),
          connections: new Map(connections.map((c) => [c.id, c])),
          characters: new Map([pilots[0]!, { ...pilots[1]!, online: false }].map((p) => [p.characterId, p])),
        }}
      />,
    );
    const title = (name: string) => region(name).querySelector('header')!.firstElementChild!.textContent;
    expect(title('Signatures')).toBe('Signatures32 unscanned · 1 WH');
    expect(title('Local')).toBe('Local21 offline');
    expect(title('Connections')).toBe('Connections11 EOL · 1 crit');
    await waitFor(() => expect(title('Kills')).toBe('Kills14h'));
    // The holder, the kill intel and the statics each live in one widget.
    expect(screen.getAllByRole('list', { name: 'Statics' })).toHaveLength(1);
    expect(screen.getAllByRole('group', { name: 'Kill intel' })).toHaveLength(1);
    expect(within(region('Kills')).queryByRole('group', { name: 'Kill intel' })).toBeNull();
  });

  it('System info shows the system’s status, Labels, Tags and notes, with nothing to edit', () => {
    wrap(
      <Widgets
        state={{}}
        system={{
          status: 'hostile',
          systemLabelIds: ['wh2'],
          labelIds: ['l1'],
          customLabel: 'bait',
          temporaryName: 'C3a',
          description: 'Loki fleet lives here.\n\nThey log in at 19:00.',
        }}
      />,
    );
    const info = region('System info');
    expect(within(info).getByRole('img', { name: 'Status: Hostile' })).toBeTruthy();
    // Only the system's own Labels and Tags, as the map draws them.
    expect(
      within(within(info).getByRole('list', { name: 'Labels' }))
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['WH2', 'bait']);
    expect(within(within(info).getByRole('list', { name: 'Tags' })).getByText('Staging')).toBeTruthy();
    expect(info.textContent).toContain('C3a');
    expect(within(info).getByLabelText('Notes').textContent).toContain('Loki fleet lives here.');
    // Nothing to type into or toggle.
    expect(within(info).queryAllByRole('textbox')).toEqual([]);
    expect(within(info).queryByRole('button', { name: 'WH1' })).toBeNull();
    expect(within(info).queryByRole('button', { name: /Status/ })).toBeNull();
  });

  it('System info sums up the kill intel: kills, the last kill, the busiest hours and who kills here', async () => {
    wrap(<Widgets state={{}} />);
    const intel = await within(region('System info')).findByRole('group', { name: 'Kill intel' });
    await waitFor(() => expect(intel.textContent).toContain('Kills61h624h'));
    expect(within(intel).getByRole('img', { name: 'Kills per hour, last 24 hours' })).toBeTruthy();
    expect(intel.textContent).toContain('Last kill');
    expect(intel.textContent).toContain('Guardian');
    const killers = within(intel).getByRole('list', { name: 'Most kills here, last 7 days' });
    expect(killers.textContent).toBe('[HPTY]9');
    expect(within(killers).getByRole('link', { name: '[HPTY]' }).getAttribute('href')).toBe(
      'https://zkillboard.com/alliance/99000002/',
    );
  });

  it('pastes probe scanner text with Ctrl+V anywhere outside a text field', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(
        buildPath(routes.signatures.paste.path, { mapId: MAP_ID, solarSystemId: WH }),
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ added: 3, updated: 1, removed: 0, skipped: [] });
        },
      ),
    );
    wrap(<Widgets state={{ signatures: new Map([['s1', signatureFixture('s1', WH, 'XYZ-999')]]) }} />);
    // With signatures listed, the field gives way to Ctrl+V and the title bar's button.
    expect(screen.queryByRole('textbox', { name: 'Paste probe scanner results' })).toBeNull();
    expect(within(region('Signatures')).getByRole('checkbox', { name: 'Remove missing' })).toBeTruthy();
    const paste = (target: EventTarget, text: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
      act(() => void target.dispatchEvent(event));
    };
    // Into a field it is the field's text; random text is not a scan.
    const field = document.createElement('input');
    document.body.append(field);
    paste(field, 'ABC-123\tCosmic Signature');
    field.remove();
    paste(document.body, 'hello there');
    expect(bodies).toEqual([]);

    paste(document.body, 'ABC-123\tCosmic Signature\tWormhole\t\t0.0%\t2.1 AU');
    expect(await screen.findByText('3 new / 1 updated')).toBeTruthy();
    expect(bodies).toEqual([
      { text: 'ABC-123\tCosmic Signature\tWormhole\t\t0.0%\t2.1 AU', mode: 'replace' },
    ]);
  });

  it('Local lists who is in the system, mine first and highlighted, with their ships', () => {
    wrap(<Widgets state={{ characters: new Map(pilots.map((p) => [p.characterId, p])) }} />);
    const local = region('Local');
    const rows = within(local).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      `${me.characters[0]!.name} (you)${me.characters[0]!.name}'s Loki`,
      "Hostile GuyHostile Guy's Loki",
    ]);
    expect(rows[0]!.dataset.mine).toBe('true');
    expect(rows[1]!.dataset.mine).toBeUndefined();
    expect(within(local.querySelector('header')!).getByText('2')).toBeTruthy();
  });

  it('Local counts the hostile pilots in its title bar and colours them by standing', async () => {
    server.use(
      http.get(routes.intel.standings.path, () =>
        HttpResponse.json({
          standings: [{ id: 95_000_001, standing: -10, kind: 'character' }],
          missingScopes: false,
          overrides: [],
        }),
      ),
    );
    wrap(<Widgets state={{ characters: new Map(pilots.map((p) => [p.characterId, p])) }} />);
    const title = () => region('Local').querySelector('header')!.firstElementChild!.textContent;
    await waitFor(() => expect(title()).toBe('Local21 hostile'));
    expect(within(region('Local')).getByText('Hostile Guy').getAttribute('style')).toContain(
      'standing-terrible',
    );
  });

  it('Kills lists the killmails only, with choices for the list', async () => {
    const user = userEvent.setup();
    wrap(<Widgets state={{}} />);
    const kills = region('Kills');
    expect(await within(kills).findByText('Guardian')).toBeTruthy();
    expect(within(kills).getByText('1.3b')).toBeTruthy();
    expect(within(kills).getByText('by [HPTY] +3')).toBeTruthy();
    expect(
      within(kills)
        .getByRole('link', { name: /Killmail Guardian on zKillboard/ })
        .getAttribute('href'),
    ).toBe('https://zkillboard.com/kill/1/');
    // The system's numbers are System info's.
    expect(within(kills).queryByRole('group', { name: 'Kill intel' })).toBeNull();
    expect(within(kills).queryByText('Who flies here')).toBeNull();

    // Every system on the map: the system's name leads each row.
    await user.click(within(kills).getByRole('button', { name: 'Kill list settings' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Every system on the map' }));
    await user.keyboard('{Escape}');
    expect(await within(kills).findByText(/Jita/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(`dbk-kills-settings:${MAP_ID}`)!)).toMatchObject({
      scope: 'all',
    });
  });

  it('System info names the holder and the claiming corporation, and asks to link again for standings', async () => {
    const held = activityFixture();
    held.intel.sovereignty = {
      kind: 'alliance',
      holder: { id: 1354830081, name: 'Goonswarm Federation', ticker: 'CONDI' },
      corporation: { id: 98000001, name: 'KarmaFleet', ticker: 'KARMA' },
    };
    server.use(
      http.get(routes.intel.system.path, () => HttpResponse.json(held)),
      http.get(routes.intel.standings.path, () =>
        HttpResponse.json({ standings: [], missingScopes: true, overrides: [] }),
      ),
    );
    wrap(<Widgets state={{}} />);
    const info = region('System info');
    expect(await within(info).findByText('Goonswarm Federation')).toBeTruthy();
    expect(info.textContent).toContain('claimed by KarmaFleet [KARMA]');
    const relink = await within(info).findByRole('link', { name: 'Link your characters again' });
    expect(relink.getAttribute('href')).toContain('/api/auth/eve/login');
  });
});

describe('window geometry', () => {
  const area = { width: 1440, height: 848 };

  it('keeps windows 10 px inside the map and snaps them to its edges and to each other', () => {
    expect(clampBox({ x: -50, y: 900, w: 300, h: 200 }, area)).toEqual({ x: 10, y: 638, w: 300, h: 200 });
    // 7 px from the left edge's line: snapped onto it.
    expect(moveBox({ x: 100, y: 100, w: 300, h: 200 }, -83, 0, area, []).x).toBe(GUTTER);
    // Next to another window: 10 px apart, tops aligned.
    const other = { x: 500, y: 104, w: 200, h: 200 };
    expect(moveBox({ x: 100, y: 100, w: 300, h: 200 }, 85, 0, area, [other])).toMatchObject({
      x: 190,
      y: 104,
    });
  });

  it('resizes from a corner, never below the minimum, the opposite corner staying', () => {
    const start = { x: 400, y: 100, w: 300, h: 300 };
    expect(resizeBox(start, { x: -1, y: -1 }, 40, 30, area, [])).toEqual({ x: 440, y: 130, w: 260, h: 270 });
    expect(resizeBox(start, { x: 1, y: 1 }, -1000, -1000, area, [])).toEqual({
      x: 400,
      y: 100,
      w: MIN_SIZE.w,
      h: MIN_SIZE.h,
    });
  });

  it('keeps a window by the right or bottom edge there on another screen size', () => {
    const box = { x: 1040, y: 600, w: 390, h: 238 };
    const stored = toStored(box, area);
    expect(stored).toMatchObject({ right: true, bottom: true, x: 10, y: 10 });
    expect(fromStored(stored, { width: 1920, height: 1028 })).toEqual({ x: 1520, y: 780, w: 390, h: 238 });
    expect(toStored({ x: 10, y: 10, w: 300, h: 200 }, area)).toEqual({ x: 10, y: 10, w: 300, h: 200 });
  });

  it('docks a narrow column: about 360 px, 320-400, never more than 30% of the map', () => {
    expect(dockWidth({ width: 1440, height: 848 })).toBe(360);
    expect(dockWidth({ width: 1920, height: 1028 })).toBe(400);
    expect(dockWidth({ width: 1000, height: 600 })).toBe(300);
    expect(dockWidth({ width: 1440, height: 848 }, 333)).toBe(333);
  });

  it('sizes docked windows to their content, up to their share of the map', () => {
    const column = dockColumn(['kills', 'info', 'local', 'signatures'], area, {
      info: 110,
      signatures: 900,
      local: 48,
      kills: 60,
    });
    // System info, Signatures, Local, Routes, Kills: top to bottom.
    expect(Object.keys(column)).toEqual(['info', 'signatures', 'local', 'kills']);
    expect(column.info).toEqual({ x: 1440 - GUTTER - 360, y: GUTTER, w: 360, h: 110 });
    // Signatures stops at 45% of the map and scrolls; a pilot list of two is two rows tall.
    expect(column.signatures!.h).toBe(Math.round(848 * 0.45));
    expect(column.signatures!.y).toBe(GUTTER + 110 + DOCK_GAP);
    expect(column.local!.h).toBe(48);
    expect(column.kills!.y).toBe(column.local!.y + 48 + DOCK_GAP);
    // A cap someone set wins.
    expect(dockColumn(['signatures'], area, { signatures: 900 }, { signatures: 200 }).signatures!.h).toBe(
      200,
    );
  });

  it('shrinks the lowest windows first when the column runs past the bottom', () => {
    const small = { width: 1000, height: 600 };
    const column = dockColumn(['info', 'signatures', 'local', 'routes', 'kills'], small, {
      info: 150,
      signatures: 400,
      local: 200,
      routes: 120,
      kills: 200,
    });
    const last = column.kills!;
    expect(last.y + last.h).toBeLessThanOrEqual(small.height - GUTTER);
    expect(column.info!.h).toBe(150);
    // Kills and Routes give way first, then Signatures down to five rows, then Local; System info
    // keeps its content.
    expect(column.kills!.h).toBe(52);
    expect(column.routes!.h).toBe(52);
    expect(column.signatures!.h).toBe(160);
    expect(column.local!.h).toBe(600 - 2 * GUTTER - 4 * DOCK_GAP - 150 - 160 - 2 * 52);
  });

  it('floats a window someone moved, as tall as its content up to the height it was given', () => {
    const layout: WidgetsLayout = {
      ...EMPTY_LAYOUT,
      boxes: { signatures: { x: 20, y: 30, w: 400, h: 300 } },
    };
    const resolved = resolveBoxes(layout, area, DEFAULT_VISIBLE, { signatures: 120, info: 100 });
    expect(resolved.boxes.signatures).toEqual({ x: 20, y: 30, w: 400, h: 120 });
    expect([...resolved.docked]).toEqual(['info', 'local', 'routes', 'kills']);
    expect(resolved.column!.width).toBe(360 + 2 * GUTTER);
    const kills = resolved.boxes.kills!;
    expect(resolved.column!.bottom).toBe(kills.y + kills.h + GUTTER);
    expect(resolveBoxes(EMPTY_LAYOUT, area, []).column).toBeNull();
  });

  it('keeps a resized docked window’s height and the column’s width', () => {
    const resized = resizeDocked(EMPTY_LAYOUT, 'local', { x: 1000, y: 200, w: 380, h: 150 }, area);
    expect(resized.caps).toEqual({ local: 150 });
    expect(resized.dockWidth).toBe(380);
    expect(resizeDocked(resized, 'local', { x: 0, y: 0, w: 380, h: 90 }, area).dockWidth).toBe(380);
  });

  it('reads layouts kept before the column: the widgets stay, the windows go back to it', () => {
    const v1 = {
      visible: ['info', 'local'],
      boxes: { local: { x: 1, y: 2, w: 300, h: 600 } },
      order: ['local'],
    };
    expect(parseLayout(v1)).toEqual({
      version: LAYOUT_VERSION,
      visible: ['info', 'local'],
      boxes: {},
      order: ['local'],
    });
    const v2 = { ...v1, version: LAYOUT_VERSION, caps: { local: 200 } };
    expect(parseLayout(v2)).toEqual(v2);
    expect(parseLayout({ visible: 3 })).toBeNull();
    expect(parseLayout(null)).toBeNull();
  });

  it('carries the old sidebar’s hidden sections over as hidden widgets', () => {
    expect(migrateSidebarLayout({ hidden: ['system', 'kills', 'activity'], order: [] })).toEqual([
      'signatures',
      'local',
      'routes',
    ]);
    expect(migrateSidebarLayout({ hidden: ['history'], order: ['local'] })).toBeNull();
    expect(migrateSidebarLayout('nonsense')).toBeNull();
  });
});

describe('Edit system', () => {
  beforeAll(() => {
    // Radix Select reads pointer capture and scrolls the chosen option into view; jsdom has neither.
    Object.assign(Element.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    });
  });

  function Dialog({
    system,
    info = universe[WH],
    role = 'member',
    bookmark = null,
    onManageTags,
    onClose = () => {},
  }: {
    system?: Partial<MapSystemDto>;
    info?: UniverseSystemDto;
    role?: 'member' | 'manager';
    bookmark?: string | null;
    onManageTags?(): void;
    onClose?(): void;
  }) {
    const store = useMapStore(MAP_ID);
    return (
      <EditSystemDialog
        system={systemFixture(info?.id ?? WH, system)}
        info={info}
        labels={mapDto.labels}
        systemLabels={mapDto.systemLabels ?? []}
        bookmark={bookmark}
        can={mapPermissions(role)}
        store={store}
        onManageLabels={() => {}}
        onManageTags={onManageTags}
        onClose={onClose}
      />
    );
  }

  function recordPatches(solarSystemId = WH) {
    const patches: unknown[] = [];
    server.use(
      http.patch(
        buildPath(routes.systems.update.path, { mapId: MAP_ID, solarSystemId }),
        async ({ request }) => {
          patches.push(await request.json());
          return HttpResponse.json(systemFixture(solarSystemId));
        },
      ),
    );
    return patches;
  }

  it('edits the names, status, labels, custom label, tags and notes, each saved as it is made', async () => {
    const patches = recordPatches();
    const user = userEvent.setup();
    wrap(<Dialog system={{ status: 'hostile' }} />);
    const dialog = screen.getByRole('dialog', { name: /Edit system/ });
    // No free-text tag.
    expect(within(dialog).queryByRole('textbox', { name: 'Tag' })).toBeNull();
    await user.type(within(dialog).getByRole('textbox', { name: 'Temporary name' }), 'C3a{Enter}');
    // Enter saves the field and leaves the dialog open.
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Status is one select: the current one with its name, the list with a line on each.
    const status = within(dialog).getByRole('combobox', { name: 'Status' });
    expect(status.textContent).toBe('Hostile');
    await user.click(status);
    const friendly = await screen.findByRole('option', { name: /^Friendly/ });
    expect(friendly.textContent).toContain('Friends live here.');
    await user.click(friendly);

    const labels = within(dialog).getByRole('group', { name: 'Labels' });
    expect(
      within(labels)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['WH1', 'WH2']);
    await user.click(within(labels).getByRole('button', { name: 'WH2' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Custom label' }), 'bait{Enter}');
    await user.type(within(dialog).getByRole('textbox', { name: 'Notes' }), 'Loki fleet in C3');
    await user.click(
      within(within(dialog).getByRole('group', { name: 'Tags' })).getByRole('button', { name: 'Staging' }),
    );
    await waitFor(() => expect(patches).toHaveLength(6));
    expect(patches.slice(0, 4)).toEqual([
      { temporaryName: 'C3a' },
      { status: 'friendly' },
      { systemLabelIds: ['wh2'] },
      { customLabel: 'bait' },
    ]);
    expect(patches.slice(4)).toEqual(
      expect.arrayContaining([{ description: 'Loki fleet in C3' }, { labelIds: ['l1'] }]),
    );
    // The header says the changes are in.
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Saved'));
  });

  it('marks what is on unmistakably and previews the chips above the node in map order', () => {
    wrap(
      <Dialog
        system={{ systemLabelIds: ['wh2'], customLabel: 'bait', labelIds: ['l1'] }}
        bookmark="ABC-123"
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /Edit system/ });
    const labels = within(dialog).getByRole('group', { name: 'Labels' });
    const wh1 = within(labels).getByRole('button', { name: 'WH1' });
    const wh2 = within(labels).getByRole('button', { name: 'WH2' });
    expect(wh1.getAttribute('aria-pressed')).toBe('false');
    expect(wh2.getAttribute('aria-pressed')).toBe('true');
    // On carries a check; off does not.
    expect(wh2.querySelector('svg')).not.toBeNull();
    expect(wh1.querySelector('svg')).toBeNull();
    const staging = within(within(dialog).getByRole('group', { name: 'Tags' })).getByRole('button', {
      name: 'Staging',
    });
    expect(staging.getAttribute('aria-pressed')).toBe('true');
    expect(staging.querySelector('svg')).not.toBeNull();

    const above = within(dialog).getByRole('list', { name: 'Above the system' });
    expect(
      within(above)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['WH2', 'bait', 'ABC-123', 'Staging']);
    expect(
      (within(dialog).getByRole('textbox', { name: 'Custom label' }) as HTMLInputElement).maxLength,
    ).toBe(16);
  });

  it('heads a wormhole with its class, never its region code, and known space with region › constellation', () => {
    const { unmount } = wrap(<Dialog />);
    let dialog = screen.getByRole('dialog', { name: /Edit system/ });
    expect(within(dialog).getByRole('heading', { name: /J100001/ })).toBeTruthy();
    const described = () => document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent;
    expect(described()).toContain('Class 3 wormhole');
    expect(described()).not.toContain('A-R00001');
    // The real name is the custom name's placeholder.
    expect(
      (within(dialog).getByRole('textbox', { name: 'Custom name' }) as HTMLInputElement).placeholder,
    ).toBe('J100001');
    unmount();

    wrap(<Dialog info={universe[JITA]} />);
    dialog = screen.getByRole('dialog', { name: /Edit system/ });
    expect(described()).toContain('The Forge › Kimotoro');
  });

  it('clears a name with its button; Escape puts unsaved typing back first, then closes', async () => {
    const patches = recordPatches();
    const onClose = vi.fn();
    const user = userEvent.setup();
    wrap(<Dialog system={{ customName: 'Home' }} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: /Edit system/ });
    await user.click(within(dialog).getByRole('button', { name: 'Clear custom name' }));
    await waitFor(() => expect(patches).toEqual([{ customName: null }]));

    const temp = within(dialog).getByRole('textbox', { name: 'Temporary name' }) as HTMLInputElement;
    await user.type(temp, 'C3b');
    await user.keyboard('{Escape}');
    expect(temp.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(patches).toHaveLength(1);
  });

  it('shows the lock and Manage tags to managers only', async () => {
    const patches = recordPatches();
    const onManageTags = vi.fn();
    const user = userEvent.setup();
    const { unmount } = wrap(<Dialog onManageTags={onManageTags} />);
    let dialog = screen.getByRole('dialog', { name: /Edit system/ });
    expect(within(dialog).queryByRole('switch', { name: /Lock position/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Manage tags' })).toBeNull();
    unmount();

    wrap(<Dialog role="manager" onManageTags={onManageTags} />);
    dialog = screen.getByRole('dialog', { name: /Edit system/ });
    await user.click(within(dialog).getByRole('switch', { name: /Lock position/ }));
    await waitFor(() => expect(patches).toEqual([{ locked: true }]));
    await user.click(within(dialog).getByRole('button', { name: 'Manage tags' }));
    expect(onManageTags).toHaveBeenCalled();
  });
});

/**
 * The windows' own stylesheet in the document, with the class names this build gives them: what
 * a press can reach depends on its `pointer-events` rules.
 */
function installWindowStyles() {
  const css = readFileSync(join(process.cwd(), 'apps/web/src/map/widgets/window.module.css'), 'utf8')
    .replace(/:global\(([^)]*)\)/g, '$1')
    .replace(/\.([a-zA-Z][\w-]*)/g, (all, name: string) => {
      const generated = (win as Record<string, string | undefined>)[name];
      return generated ? `.${generated}` : all;
    });
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
}

describe('menus in widget windows', () => {
  it('open one at a time: a press outside the open menu, on another window too, only closes it', async () => {
    const removeStyles = installWindowStyles();
    try {
      const user = userEvent.setup();
      const signatures = [
        signatureFixture('s1', WH, 'ABC-123', { group: 'wormhole' }),
        signatureFixture('s2', WH, 'DEF-456', { group: 'wormhole' }),
      ];
      const connections = [connectionFixture('c1', WH, JITA)];
      wrap(
        <Widgets
          state={{
            signatures: new Map(signatures.map((s) => [s.id, s])),
            connections: new Map(connections.map((c) => [c.id, c])),
          }}
        />,
      );
      // An open menu hides the rest from assistive technology (aria-hidden): look past that.
      const link = (eveId: string) =>
        screen.getByRole('button', { name: `Link ${eveId} to a connection`, hidden: true });
      const windowOf = (name: string) => screen.getByRole('region', { name, hidden: true });
      const menus = () => screen.queryAllByRole('menu');

      await user.click(link('ABC-123'));
      expect(menus()).toHaveLength(1);
      expect(link('ABC-123').getAttribute('aria-expanded')).toBe('true');

      // While a menu is open everything outside it is inert, the windows' contents included: the
      // other row's link button cannot be pressed (it used to open a second menu over the first,
      // and the first then stayed open whatever was pressed).
      await expect(user.click(link('DEF-456'))).rejects.toThrow(/pointer-events: none/);
      expect(menus()).toHaveLength(1);
      // The press lands on the window, which only closes the menu.
      await user.click(windowOf('Signatures'));
      await waitFor(() => expect(menus()).toHaveLength(0));
      expect(link('ABC-123').getAttribute('aria-expanded')).toBe('false');

      // The next press opens the other one, alone.
      await user.click(link('DEF-456'));
      expect(menus()).toHaveLength(1);
      expect(link('DEF-456').getAttribute('aria-expanded')).toBe('true');
      // Another window's menu: the same.
      const routeOptions = within(windowOf('Routes')).getByRole('button', {
        name: 'Route options',
        hidden: true,
      });
      await expect(user.click(routeOptions)).rejects.toThrow(/pointer-events: none/);
      await user.click(windowOf('Routes'));
      await waitFor(() => expect(menus()).toHaveLength(0));
      await user.click(routeOptions);
      expect(menus()).toHaveLength(1);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(menus()).toHaveLength(0));
    } finally {
      removeStyles();
    }
  });
});
