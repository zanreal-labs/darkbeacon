// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  defaultBoxes,
  EMPTY_LAYOUT,
  fromStored,
  GUTTER,
  LAYOUT_KEY,
  migrateSidebarLayout,
  MIN_SIZE,
  moveBox,
  placeNew,
  resizeBox,
  toStored,
  type Box,
  type WidgetsLayout,
} from './layout';
import { MapWidgets } from './MapWidgets';
import { useWidgetsLayout } from './useWidgetsLayout';

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
      '7d': [],
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
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: { configurable: true, get: layerSize('width') },
  clientHeight: { configurable: true, get: layerSize('height') },
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

  it('shows Wanderer’s widgets over the map, empty until a system is selected', async () => {
    view();
    await node(WH);
    // The default set, each a window of its own, saying nothing is selected.
    for (const name of ['System info', 'Signatures', 'Local', 'Routes', 'Kills']) {
      expect(within(region(name)).getByText('No system selected')).toBeTruthy();
    }
    expect(screen.queryByRole('region', { name: 'Structures' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();

    // A plain click: d3-drag reads `event.view` on mousedown, which jsdom leaves empty.
    fireEvent.click(await node(WH));
    expect(await within(region('System info')).findByRole('heading', { name: 'J100001' })).toBeTruthy();
    expect(within(region('Signatures')).getByText('ABC-123')).toBeTruthy();
    expect(await within(region('Local')).findByText('Hostile Guy')).toBeTruthy();
    expect(screen.queryByText('No system selected')).toBeNull();
  });

  it('shows and hides widgets from the top bar’s menu, and resets the layout', async () => {
    const user = userEvent.setup();
    view();
    await node(WH);
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Structures' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Kills' }));
    await user.keyboard('{Escape}');
    expect(region('Structures')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Kills' })).toBeNull();
    // Turned on, it got a free spot and keeps it.
    const layout = storedLayout()!;
    expect(layout.visible).toEqual(['info', 'signatures', 'local', 'routes', 'structures']);
    expect(layout.boxes.structures).toBeTruthy();

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
        focusToken={0}
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
  it('lays the default set out side by side against the right edge, none over another', () => {
    wrap(<Widgets state={{}} />);
    const boxes = ['System info', 'Signatures', 'Local', 'Routes', 'Kills'].map(windowBox);
    for (const [i, a] of boxes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(GUTTER);
      expect(a.y).toBeGreaterThanOrEqual(GUTTER);
      expect(a.x + a.w).toBeLessThanOrEqual(AREA.width - GUTTER);
      expect(a.y + a.h).toBeLessThanOrEqual(AREA.height - GUTTER);
      for (const b of boxes.slice(i + 1))
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    // Signatures right under System info, Local beside them as tall as both.
    const [info, sigs, local] = boxes as [Box, Box, Box];
    expect(sigs.x).toBe(info.x);
    expect(sigs.y).toBe(info.y + info.h + GUTTER);
    expect(local.x + local.w + GUTTER).toBe(info.x);
    expect(local.h).toBe(info.h + GUTTER + sigs.h);
    expect(info.x + info.w).toBe(AREA.width - GUTTER);
  });

  it('is dragged by its title bar, resized from a corner, and stays where it was left', () => {
    const first = wrap(<Widgets state={{}} />);
    const sigs = windowBox('Signatures');
    const title = region('Signatures').querySelector('header')!;
    fireEvent.pointerDown(title, { button: 0, clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(title, { clientX: 300, clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(title, { pointerId: 1 });
    expect(windowBox('Signatures')).toMatchObject({ x: sigs.x - 200, y: sigs.y + 40 });

    const corner = region('Signatures').querySelector<HTMLElement>('[data-corner="se"]')!;
    fireEvent.pointerDown(corner, { button: 0, clientX: 0, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(corner, { clientX: 60, clientY: -100, pointerId: 2 });
    fireEvent.pointerUp(corner, { pointerId: 2 });
    const moved = windowBox('Signatures');
    expect(moved).toEqual({ x: sigs.x - 200, y: sigs.y + 40, w: sigs.w + 60, h: sigs.h - 100 });
    expect(storedLayout()!.boxes.signatures).toBeTruthy();
    first.unmount();

    wrap(<Widgets state={{}} />);
    expect(windowBox('Signatures')).toEqual(moved);
  });

  it('is a focusable, labelled region the arrow keys move and, with Shift, resize', () => {
    wrap(<Widgets state={{}} />);
    const local = region('Local');
    const before = windowBox('Local');
    act(() => local.focus());
    expect(document.activeElement).toBe(local);
    expect(local.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.keyDown(local, { key: 'ArrowLeft' });
    fireEvent.keyDown(local, { key: 'ArrowDown', shiftKey: true });
    expect(windowBox('Local')).toEqual({ ...before, x: before.x - 10, h: before.h + 10 });
  });

  it('comes to the front when touched', () => {
    wrap(<Widgets state={{}} />);
    fireEvent.pointerDown(region('Routes'));
    const z = (name: string) => Number(region(name).style.zIndex);
    expect(z('Routes')).toBeGreaterThan(z('Signatures'));
    fireEvent.pointerDown(region('Signatures'));
    expect(z('Signatures')).toBeGreaterThan(z('Routes'));
  });

  it('says no system is selected in every window while none is', () => {
    wrap(<Widgets state={{}} selected={false} />);
    expect(screen.getAllByText('No system selected')).toHaveLength(5);
  });

  it('is a dock with one sheet at a time on phones, as in Wanderer', async () => {
    screenWidth(true);
    const user = userEvent.setup();
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
    expect(info.textContent).toContain('A-R00001 › A-C00311');
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
    // The holder, the activity and the statics each live in one widget.
    expect(screen.getAllByRole('list', { name: 'Statics' })).toHaveLength(1);
    expect(within(region('Kills')).getByText('Kills 1h')).toBeTruthy();
    expect(within(region('System info')).queryByText('Kills 1h')).toBeNull();
  });

  it('System info changes the status from its chip', async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch(
        buildPath(routes.systems.update.path, { mapId: MAP_ID, solarSystemId: WH }),
        async ({ request }) => {
          patches.push(await request.json());
          return HttpResponse.json(systemFixture(WH));
        },
      ),
    );
    const user = userEvent.setup();
    wrap(<Widgets state={{}} system={{ status: 'hostile' }} />);
    await user.click(within(region('System info')).getByRole('button', { name: 'Status: Hostile' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Friendly' }));
    await waitFor(() => expect(patches).toEqual([{ status: 'friendly' }]));
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
    paste(screen.getByRole('textbox', { name: 'Custom name' }), 'ABC-123\tCosmic Signature');
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

  it('System info edits labels, the custom label, tags and notes in place; no free-text tag', async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch(
        buildPath(routes.systems.update.path, { mapId: MAP_ID, solarSystemId: WH }),
        async ({ request }) => {
          patches.push(await request.json());
          return HttpResponse.json(systemFixture(WH));
        },
      ),
    );
    const user = userEvent.setup();
    wrap(<Widgets state={{}} />);
    expect(screen.queryByRole('textbox', { name: 'Tag' })).toBeNull();
    // Labels come before Tags, each a row of its own.
    const terms = [...document.querySelectorAll('dt')].map((d) => d.textContent);
    expect(terms.indexOf('Labels')).toBeLessThan(terms.indexOf('Tags'));
    const labels = screen.getByRole('group', { name: 'Labels' });
    expect(
      within(labels)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['WH1', 'WH2']);
    await user.click(within(labels).getByRole('button', { name: 'WH2' }));
    await user.type(screen.getByRole('textbox', { name: 'Custom label' }), 'bait{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Loki fleet in C3');
    await user.click(
      within(screen.getByRole('group', { name: 'Tags' })).getByRole('button', { name: 'Staging' }),
    );
    // The notes are saved as the field is left, while the tag's own save is on its way.
    await waitFor(() => expect(patches).toHaveLength(4));
    expect(patches.slice(0, 2)).toEqual([{ systemLabelIds: ['wh2'] }, { customLabel: 'bait' }]);
    expect(patches.slice(2)).toEqual(
      expect.arrayContaining([{ description: 'Loki fleet in C3' }, { labelIds: ['l1'] }]),
    );
  });

  it('Kills shows the last hour, the killmails with choices for the list, and who flies here', async () => {
    const user = userEvent.setup();
    wrap(<Widgets state={{}} />);
    const kills = region('Kills');
    // Kills of the last hour, busy from five on.
    const stat = await within(kills).findByText('Kills 1h');
    expect(stat.parentElement!.dataset.tone).toBe('hot');
    expect(within(kills).getByRole('img', { name: 'Kills 1h per hour, last 24 hours' })).toBeTruthy();
    expect(await within(kills).findByText('Guardian')).toBeTruthy();
    expect(within(kills).getByText('1.3b')).toBeTruthy();
    expect(within(kills).getByText('by [HPTY] +3')).toBeTruthy();
    expect(
      within(kills)
        .getByRole('link', { name: /Killmail Guardian on zKillboard/ })
        .getAttribute('href'),
    ).toBe('https://zkillboard.com/kill/1/');
    // Who flies here: the last day by default, with links out.
    expect(within(kills).getByText('Hunting Party')).toBeTruthy();
    expect(within(kills).getByText('4 kills · 1 loss')).toBeTruthy();
    expect(
      within(kills).getByRole('link', { name: 'Hunting Party on zKillboard' }).getAttribute('href'),
    ).toBe('https://zkillboard.com/alliance/99000002/');
    expect(within(kills).getByRole('link', { name: 'Victim Corp on EVE Who' }).getAttribute('href')).toBe(
      'https://evewho.com/corporation/98000001',
    );
    await user.click(within(kills).getByRole('radio', { name: '7d' }));
    expect(within(kills).getByText('No killmails here in the last week.')).toBeTruthy();

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

  it('lays the defaults out without overlap on common screens', () => {
    for (const size of [area, { width: 1920, height: 1028 }, { width: 1024, height: 700 }]) {
      const boxes = DEFAULT_VISIBLE.map((id) => clampBox(defaultBoxes(size)[id]!, size));
      for (const [i, a] of boxes.entries())
        for (const b of boxes.slice(i + 1))
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  });

  it('puts a widget turned on in a free spot', () => {
    const taken = Object.values(defaultBoxes(area)).slice(0, 5);
    const spot = placeNew('history', area, taken);
    for (const t of taken)
      expect(
        spot.x + spot.w <= t.x || t.x + t.w <= spot.x || spot.y + spot.h <= t.y || t.y + t.h <= spot.y,
      ).toBe(true);
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
