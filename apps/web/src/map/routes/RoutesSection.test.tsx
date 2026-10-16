// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import {
  DEFAULT_ROUTE_PREFERENCES,
  routes,
  type HubRouteDto,
  type HubRoutesDto,
  type RouteStepDto,
} from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import { MAP_ID, meFixture } from '../../test/fixtures';
import { renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { SECURITY_COLORS } from '../nodeFacts';
import { RoutesWidget, unreachableText } from './RoutesSection';
import { SPACE_COLORS, stepClass, stepClassColor, stepLook } from './RouteStrip';

const step = (
  solarSystemId: number,
  name: string,
  security: number,
  extra: Partial<RouteStepDto> = {},
): RouteStepDto => ({
  solarSystemId,
  name,
  security,
  whClass: security >= 0.45 ? 7 : security > 0 ? 8 : 9,
  classLabel: null,
  via: 'gate',
  connectionId: null,
  regionName: 'The Forge',
  ...extra,
});

const START = step(31000001, 'J100001', -1, { whClass: 3, via: 'start', regionName: 'A-R00001' });
const jita: HubRouteDto = {
  solarSystemId: 30000142,
  name: 'Jita',
  security: 0.946,
  kind: 'map',
  near: null,
  jumps: 3,
  steps: [
    START,
    step(30002813, 'Tama', 0.3, { via: 'wormhole', connectionId: 'c1', regionName: 'The Citadel' }),
    step(30000144, 'Perimeter', 0.94, { edge: 'ansiblex', via: 'bridge' }),
    step(30000142, 'Jita', 0.946),
  ],
};
const far: HubRouteDto = { ...jita, solarSystemId: 30002187, name: 'Amarr', jumps: null, steps: [] };

const queries: URLSearchParams[] = [];
/** What the next hub routes request answers for the map's hubs. */
let mapHubRoutes: Pick<HubRoutesDto, 'routes' | 'unreachable'> = { routes: [jita, far] };
setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  http.get(routes.routing.hubs.path, () => HttpResponse.json({ trade: [], map: [jita, far], personal: [] })),
  http.get(routes.routing.hubRoutes.path, ({ request }) => {
    const query = new URL(request.url).searchParams;
    queries.push(query);
    const body: HubRoutesDto = {
      from: 31000001,
      mode: 'shortest',
      limit: 20,
      ...(query.get('hubs') === 'personal' ? { routes: [] } : mapHubRoutes),
    };
    return HttpResponse.json(body);
  }),
  http.get(routes.routing.preferences.path, () => HttpResponse.json(DEFAULT_ROUTE_PREFERENCES)),
  http.put(routes.routing.updatePreferences.path, async ({ request }) =>
    HttpResponse.json({ ...DEFAULT_ROUTE_PREFERENCES, ...((await request.json()) as object) }),
  ),
);

beforeEach(() => {
  window.localStorage.clear();
  queries.length = 0;
  mapHubRoutes = { routes: [jita, far] };
});

const section = (onSelectSystem = vi.fn()) => {
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <RoutesWidget
          mapId={MAP_ID}
          solarSystemId={31000001}
          can={mapPermissions('member')}
          myCharacters={meFixture().characters}
          onMap={new Set([31000001, 30002813])}
          onSelectSystem={onSelectSystem}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
  return onSelectSystem;
};

const hexToRgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('route strip', () => {
  it("draws every system as Wanderer does: the game's security palette, its class colours and shapes", () => {
    // Known space: a square in the game's own security colour.
    expect(stepLook(step(1, 'Jita', 0.946))).toEqual({ color: SECURITY_COLORS['0.9'], shape: 'square' });
    expect(stepLook(step(1, 'Null', -0.4))).toEqual({ color: SECURITY_COLORS['0.0'], shape: 'square' });
    // Turnur is low-sec 0.4 like any other: no mark of its own in the fork or the SDE.
    expect(stepLook({ solarSystemId: 30002086, whClass: 8, security: 0.387 })).toEqual({
      color: SECURITY_COLORS['0.4'],
      shape: 'square',
    });
    // Wormhole space: rounded, in the fork's class colours; Thera white.
    expect(stepLook({ whClass: 3, security: -1 })).toEqual({ color: SPACE_COLORS.c3, shape: 'round' });
    expect(stepLook({ whClass: 3, security: -1 }).color).toBe('#a8cb70');
    expect(stepLook({ solarSystemId: 31000005, whClass: 12, security: -0.99 })).toEqual({
      color: '#ffffff',
      shape: 'round',
    });
    expect(stepLook({ whClass: 13, security: -1 }).color).toBe('#988cb5');
    expect(stepLook({ whClass: 15, security: -1 }).color).toBe('#ff44f6');
    // Pochven: a triangle in the C6 red; invaded known space a triangle in its security colour.
    expect(stepLook({ whClass: 25, security: -1 })).toEqual({ color: '#e76363', shape: 'triangle' });
    expect(stepLook({ whClass: 7, security: 0.6, invasion: 'edencom' })).toEqual({
      color: SECURITY_COLORS['0.6'],
      shape: 'triangle',
    });
    // Zarzakh in the fork's near-black, named in its security colour.
    expect(stepLook({ solarSystemId: 30100000, whClass: 9, security: -1 }).color).toBe('#212121');
    expect(stepClassColor({ solarSystemId: 30100000, whClass: 9, security: -1 })).toBe(
      SECURITY_COLORS['0.0'],
    );
    expect(stepClass({ whClass: 12, security: -1 })).toBe('Thera');
    expect(stepClass({ whClass: 25, security: -1 })).toBe('Pochven');
    expect(stepClass({ whClass: 8, security: 0.04 })).toBe('0.1');
  });
});

describe('routes section', () => {
  it('lists the map hubs nearest first, with a strip per route and a dash without one', async () => {
    const select = section();
    const list = await screen.findByRole('list', { name: 'Routes to map hubs' });
    const rows = within(list).getAllByRole('listitem');
<<<<<<< HEAD
    expect(rows.map((r) => r.textContent)).toEqual(['Jita3', 'AmarrNo connection']);
    expect(within(rows[1]!).getByText('No connection')).toBeTruthy();
    const marks = within(rows[0]!).getAllByRole('button', { name: /Tama|Perimeter|Jita,/ });
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      '0.3 Tama, The Citadel, through a wormhole',
      '0.9 Perimeter, The Forge, by jump bridge',
      '0.9 Jita, The Forge',
    ]);
=======
    expect(rows.map((r) => r.textContent)).toEqual(['Jita3', 'Amarr—']);
    expect(within(rows[1]!).getByTitle('No route')).toBeTruthy();
    const marks = within(rows[0]!).getAllByRole('button', { name: /^0\.\d / });
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual(['0.3 Tama', '0.9 Perimeter', '0.9 Jita']);
    // Off the stargates or not, a mark looks the same: no ring of our own.
    expect(marks.some((m) => m.hasAttribute('data-via'))).toBe(false);
>>>>>>> fix/route-strip-game-marks
    fireEvent.pointerEnter(marks[0]!);
    // The tooltip is the system: its security in the game's colour and its name, nothing else.
    const tip = within(rows[0]!).getByRole('tooltip');
    expect(tip.textContent).toBe('0.3Tama');
    expect((tip.firstElementChild as HTMLElement).style.color).toBe(hexToRgb(SECURITY_COLORS['0.3']!));
    // A click on a system on the map selects it; one off the map does nothing.
    fireEvent.click(marks[0]!);
    expect(select).toHaveBeenCalledWith(30002813);
    fireEvent.click(marks[2]!);
    expect(select).toHaveBeenCalledTimes(1);
    expect(queries[0]!.get('from')).toBe('31000001');
    expect(queries[0]!.get('hubs')).toBe('map');
  });

  it('has its tabs in the title bar, switches to my hubs and remembers the tab', async () => {
    section();
    await screen.findByRole('list', { name: 'Routes to map hubs' });
    const titleBar = document.querySelector('header')!;
    const tabs = within(titleBar).getByRole('radiogroup', { name: 'Routes to' });
    await waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('radio')
          .map((t) => t.textContent),
      ).toEqual(['Map 2', 'Mine', 'Nearest']),
    );
    await userEvent.click(within(tabs).getByRole('radio', { name: 'Mine' }));
    expect(await screen.findByText(/No hubs of yours/)).toBeTruthy();
    expect(window.localStorage.getItem('dbk-routes-tab')).toBe('"personal"');
  });

  it('sends the route options with every request and sums them up', async () => {
    section();
    await screen.findByRole('list', { name: 'Routes to map hubs' });
    await userEvent.click(screen.getByRole('button', { name: 'Route options' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'End-of-life holes' }));
    await waitFor(() => expect(queries.at(-1)!.get('skip')).toBe('eol'));
    expect(screen.getByRole('button', { name: 'Route options: no EOL', hidden: true })).toBeTruthy();
  });

  it('lists every hub even without a route, as "No connection" with the reason on hover', async () => {
    mapHubRoutes = {
      routes: [far, { ...far, solarSystemId: 30002659, name: 'Dodixie' }],
      unreachable: 'no-exit',
    };
    section();
    const list = await screen.findByRole('list', { name: 'Routes to map hubs' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Amarr'),
      expect.stringContaining('Dodixie'),
    ]);
    const none = within(list).getAllByText('No connection');
    expect(none).toHaveLength(2);
    expect(none[0]!.getAttribute('title')).toBe('No route out of this chain to k-space.');
    expect(unreachableText('isolated', false)).toMatch(/no connections on the map/);
    expect(unreachableText('no-exit', true)).toBe(
      'No route out of this chain to k-space with these route options.',
    );
  });

  it('adds a hub from the title bar', async () => {
    section();
    await screen.findByRole('list', { name: 'Routes to map hubs' });
    expect(screen.queryByRole('combobox', { name: 'Add a map hub' })).toBeNull();
    await userEvent.click(
      within(document.querySelector('header')!).getByRole('button', { name: 'Add a map hub' }),
    );
    expect(await screen.findByRole('combobox', { name: 'Add a map hub' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('combobox', { name: 'Add a map hub' })).toBeNull();
  });
});
