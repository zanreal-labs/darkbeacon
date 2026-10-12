// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { http, HttpResponse } from 'msw/http';
import {
  routes,
  type ConnectionIntelDto,
  type MapDto,
  type PassageDto,
  type RollPlanDto,
  type ShipCatalogDto,
  type ShipTypeDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { MapView } from '../../screens/MapView';
import { connectionFixture, eventMessage, MAP_ID, meFixture, systemFixture } from '../../test/fixtures';
import {
  FakeSocket,
  fakeRealtime,
  installFlowMocks,
  renderWithProviders,
  setupMockServer,
} from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { jumpsUntil } from './format';

installFlowMocks();

const HOME = 31002531;
const TAMA = 30002813;
const universe: Record<number, UniverseSystemDto> = {
  [HOME]: {
    id: HOME,
    name: 'J014348',
    regionName: 'C-R00030',
    constellationName: 'C-C00300',
    security: -0.99,
    whClass: 3,
    statics: ['D845', 'U210'],
    effect: 'redGiant',
  },
  [TAMA]: {
    id: TAMA,
    name: 'Tama',
    regionName: 'The Citadel',
    constellationName: 'Ihilakken',
    security: 0.3,
    whClass: 8,
    statics: [],
    effect: null,
  },
};
const megathron: ShipTypeDto = {
  id: 641,
  name: 'Megathron',
  group: 'Battleship',
  hullClass: 'battleship',
  mass: 98_400_000,
  propSize: 'large',
  propMass: 50_000_000,
  higgs: true,
  entangler: false,
};
const catalog: ShipCatalogDto = {
  modifiers: {
    prop: { small: 500_000, medium: 5_000_000, large: 50_000_000, capital: 500_000_000 },
    higgsPercent: 100,
    entanglerPercent: -80,
  },
  suggested: [megathron],
};
const hole = connectionFixture('c1', HOME, TAMA, {
  massStatus: 'reduced',
  massSaved: true,
  massStatusAt: 5_000,
});
const intel: ConnectionIntelDto = {
  connectionId: 'c1',
  type: 'wormhole',
  source: {
    solarSystemId: HOME,
    name: 'J014348',
    whClass: 3,
    classLabel: 'C3',
    security: -0.99,
    signature: null,
  },
  target: { solarSystemId: TAMA, name: 'Tama', whClass: 8, classLabel: 'LS', security: 0.3, signature: null },
  wormholeType: 'U210',
  wormholeTypeFrom: 'signature',
  wormholeTypeSide: 'source',
  timeStatus: 'normal',
  massStatus: 'reduced',
  shipSize: 'large',
  massSaved: true,
  dangerous: false,
  bubbled: 'none',
  maxJumpMass: 375_000_000,
  fits: ['frigate', 'battleship'],
  mass: {
    total: 3_000_000_000,
    passed: 148_400_000,
    since: 5_000,
    passages: 1,
    unknownPassages: 0,
    remaining: 1_351_600_000,
    remainingFraction: 0.45,
    range: { min: 121_600_000, max: 1_501_600_000 },
    overdrawn: false,
    regenerates: false,
    estimatedStatus: 'reduced',
  },
  time: {
    firstSeenAt: 1,
    lifetimeHours: 24,
    lifetimeFrom: 'type',
    eolAt: null,
    expiresBy: Date.now() + 5 * 60 * 60_000,
    remainingMs: 5 * 60 * 60_000,
  },
  totalPassages: 2,
  ageMs: 1,
  urgency: 'warning',
};
const passages: PassageDto[] = [
  {
    id: 'p2',
    connectionId: 'c1',
    characterId: null,
    shipTypeId: 641,
    shipName: 'Megathron',
    mass: 148_400_000,
    from: HOME,
    to: TAMA,
    occurredAt: Date.now() - 60_000,
    source: 'manual',
    massMode: 'hot',
    note: 'Roller 1',
    counted: true,
  },
  {
    id: 'p1',
    connectionId: 'c1',
    characterId: 90_000_001,
    characterName: 'Scout Pilot',
    shipTypeId: 28606,
    shipName: 'Orca',
    mass: 150_000_000,
    from: TAMA,
    to: HOME,
    occurredAt: 1_000,
    source: 'tracked',
    massMode: 'cold',
    counted: false,
  },
];
const plan: RollPlanDto = {
  result: 'ok',
  reason: 'collapses',
  remaining: { min: 200_000_000, max: 290_000_000 },
  maxJumpMass: 375_000_000,
  crew: [{ shipTypeId: 641, name: 'Megathron', cold: 98_400_000, hot: 148_400_000, tooHeavy: false }],
  steps: [
    {
      ship: 0,
      shipTypeId: 641,
      shipName: 'Megathron',
      direction: 'out',
      massMode: 'cold',
      mass: 98_400_000,
      usedAfter: 98_400_000,
      remainingAfter: { min: 101_600_000, max: 191_600_000 },
      collapse: 'none',
      polarized: false,
      shows: ['critical'],
    },
    {
      ship: 0,
      shipTypeId: 641,
      shipName: 'Megathron',
      direction: 'back',
      massMode: 'hot',
      mass: 148_400_000,
      usedAfter: 246_800_000,
      remainingAfter: { min: 0, max: 43_200_000 },
      collapse: 'may',
      polarized: false,
      shows: ['critical'],
    },
  ],
};

const logged: unknown[] = [];
const planned: unknown[] = [];
let passagesServed = 0;
setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  http.get(routes.universe.getSystem.path, ({ params }) =>
    HttpResponse.json(universe[Number(params.solarSystemId)]),
  ),
  http.get(routes.maps.getPreferences.path, () =>
    HttpResponse.json({ viewport: null, bookmarkTemplate: null, updatedAt: 0 }),
  ),
  http.get(routes.tracking.characters.path, () => HttpResponse.json([])),
  http.get(routes.connections.intel.path, () => HttpResponse.json([intel])),
  http.get(routes.connections.intelOne.path, () => HttpResponse.json(intel)),
  http.get(routes.connections.passages.path, () => {
    passagesServed += 1;
    return HttpResponse.json(passages);
  }),
  http.post(routes.connections.logPassages.path, async ({ request }) => {
    logged.push(await request.json());
    return HttpResponse.json([]);
  }),
  http.post(routes.connections.rollPlan.path, async ({ request }) => {
    planned.push(await request.json());
    return HttpResponse.json(plan);
  }),
  http.get(routes.universe.shipCatalog.path, () => HttpResponse.json(catalog)),
  http.get(routes.universe.searchShips.path, () => HttpResponse.json([megathron])),
  http.post(routes.universe.fitMass.path, () =>
    HttpResponse.json({
      ship: megathron,
      name: 'Roller',
      cold: 203_800_000,
      hot: 303_800_000,
      prop: '500MN Y-T8 Compact Microwarpdrive',
      counted: ['1600mm Rolled Tungsten Compact Plates', 'Large Higgs Anchor I'],
      higgs: true,
    }),
  ),
);

const mapDto: MapDto = {
  id: MAP_ID,
  slug: 'home',
  name: 'Home',
  ownerAccountId: 'acc',
  settings: { scopes: ['wormhole'] },
  labels: [],
  systemLabels: [],
  createdAt: 1,
  updatedAt: 1,
};
const snapshot: StreamSnapshotDto = {
  stream: `map:${MAP_ID}`,
  seq: 1,
  data: {
    systems: [
      systemFixture(HOME, { position: { x: 0, y: 0 } }),
      systemFixture(TAMA, { position: { x: 400, y: 0 } }),
    ],
    connections: [hole],
    signatures: [],
  },
};

const wrap = (ui: ReactElement) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
    { realtime: fakeRealtime() },
  );

const view = () =>
  wrap(
    <ReactFlowProvider>
      <div style={{ width: 1200, height: 800 }}>
        <MapView map={mapDto} role="member" snapshot={snapshot} />
      </div>
    </ReactFlowProvider>,
  );

async function openConnection() {
  await waitFor(() => expect(document.querySelector('.react-flow__edge[data-id="c1"]')).toBeTruthy());
  fireEvent.click(document.querySelector('.react-flow__edge[data-id="c1"]')!);
  return screen.findByRole('complementary', { name: 'Connection' });
}

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  logged.length = 0;
  planned.length = 0;
  passagesServed = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('the connection sidebar', () => {
  it('opens on a click on the connection: ends, states in words, mass left, the passage log', async () => {
    view();
    const sidebar = await openConnection();
    expect(within(sidebar).getByRole('heading', { name: /J014348.*Tama/ })).toBeTruthy();
    expect(await within(sidebar).findByText('Wormhole U210')).toBeTruthy();
    expect(within(sidebar).getByText('Reduced')).toBeTruthy();
    expect(within(sidebar).getByText('Mass saved')).toBeTruthy();
    for (const name of ['Connection', 'Mass', 'Passages'])
      expect(within(sidebar).getByRole('region', { name })).toBeTruthy();
    expect(await within(sidebar).findByText('121 600 – 1 501 600 t')).toBeTruthy();
    expect(within(sidebar).getAllByText('148 400 t').length).toBeGreaterThan(0);
    // Newest first; the jump from before the mass was marked stays, not counted.
    const log = within(sidebar).getByRole('region', { name: 'Passages' });
    expect(within(log).getByText('Logged by hand')).toBeTruthy();
    expect(within(log).getByText('Scout Pilot')).toBeTruthy();
    expect(within(log).getByRole('separator').textContent).toMatch(/not counted/);
    expect(within(log).getByRole('button', { name: /Counted Hot/ })).toBeTruthy();

    // Clicking an end selects that system instead.
    fireEvent.click(within(sidebar).getByRole('button', { name: /Tama/ }));
    expect(await screen.findByRole('complementary', { name: 'System' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Connection' })).toBeNull();
  });

  it('refreshes the log when a passage lands', async () => {
    view();
    const socket = FakeSocket.last!;
    act(() => socket.open());
    await openConnection();
    await waitFor(() => expect(passagesServed).toBeGreaterThan(0));
    const before = passagesServed;
    const message = eventMessage(`map:${MAP_ID}`, 'connection.passage', {
      connectionId: 'c1',
      characterId: 1,
      shipTypeId: 641,
    });
    act(() => socket.push({ ...message, event: { ...message.event, seq: 100 } }));
    await waitFor(() => expect(passagesServed).toBeGreaterThan(before), { timeout: 2000 });
  });

  it('logs a jump: ship by name, direction, hot, how many', async () => {
    const user = userEvent.setup();
    view();
    const sidebar = await openConnection();
    await user.click(within(sidebar).getByRole('button', { name: 'Log a jump' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a jump' });
    await user.click(await within(dialog).findByRole('button', { name: 'Megathron' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Tama J014348' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Hot' }));
    const jumps = within(dialog).getByRole('spinbutton', { name: 'Jumps' });
    await user.clear(jumps);
    await user.type(jumps, '2');
    expect(within(dialog).getByText('148 400 t × 2 = 296 800 t')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Log 2 jumps' }));
    await waitFor(() =>
      expect(logged).toEqual([{ shipTypeId: 641, direction: 'targetToSource', massMode: 'hot', count: 2 }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a jump' })).toBeNull());
  });

  it('logs a jump weighed from a pasted fit, as a custom mass', async () => {
    const user = userEvent.setup();
    view();
    const sidebar = await openConnection();
    await user.click(within(sidebar).getByRole('button', { name: 'Log a jump' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a jump' });
    await user.click(within(dialog).getByRole('button', { name: /pasted fit/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Fit' }), {
      target: { value: '[Megathron, Roller]\nLarge Higgs Anchor I' },
    });
    expect(await within(dialog).findByText(/203 800 t cold, 303 800 t hot/)).toBeTruthy();
    await user.click(within(dialog).getByRole('radio', { name: 'Hot' }));
    await user.click(within(dialog).getByRole('button', { name: 'Log jump' }));
    await waitFor(() =>
      expect(logged).toEqual([
        {
          shipTypeId: 641,
          direction: 'sourceToTarget',
          massMode: 'custom',
          mass: 303_800_000,
          note: 'Hot fit Roller',
          count: 1,
        },
      ]),
    );
  });

  it('plans a roll with the ships the crew picks', async () => {
    const user = userEvent.setup();
    view();
    const sidebar = await openConnection();
    await user.click(await within(sidebar).findByRole('button', { name: 'Plan a roll' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan a roll' });
    await user.click(await within(dialog).findByRole('button', { name: 'Megathron' }));
    expect(await within(dialog).findByText('Closes on the last jump home')).toBeTruthy();
    expect(planned.at(-1)).toEqual({ ships: [{ shipTypeId: 641, count: 1 }] });
    const steps = within(dialog)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('data-direction'));
    expect(steps).toHaveLength(2);
    expect(steps[1]!.textContent).toMatch(/May close it/);
    expect(within(dialog).getByRole('table')).toBeTruthy();
  });
});

describe('jumps until', () => {
  it('counts jumps to half, critical and collapse as a range, cold and hot', () => {
    const rows = jumpsUntil(
      { min: 900_000_000, max: 2_200_000_000 },
      2_000_000_000,
      { cold: 98_400_000, hot: 148_400_000 },
      375_000_000,
    );
    expect(rows.map((r) => r.target)).toEqual(['half', 'critical', 'collapse']);
    expect(rows[0]).toEqual({ target: 'half', cold: { min: 0, max: 13 }, hot: { min: 0, max: 9 } });
    expect(rows[2]!.hot).toEqual({ min: 7, max: 15 });
    expect(
      jumpsUntil({ min: 0, max: 1 }, null, { cold: 400_000_000, hot: 450_000_000 }, 375_000_000),
    ).toEqual([{ target: 'collapse', cold: null, hot: null }]);
  });
});
