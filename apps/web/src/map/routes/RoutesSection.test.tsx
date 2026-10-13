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
import { RoutesWidget } from './RoutesSection';
import { stepClass, stepLook } from './RouteStrip';

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
setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  http.get(routes.routing.hubs.path, () => HttpResponse.json({ trade: [], map: [jita, far], personal: [] })),
  http.get(routes.routing.hubRoutes.path, ({ request }) => {
    const query = new URL(request.url).searchParams;
    queries.push(query);
    const body: HubRoutesDto = {
      from: 31000001,
      mode: 'shortest',
      routes: query.get('hubs') === 'personal' ? [] : [jita, far],
      limit: 20,
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

describe('route strip', () => {
  it('draws known space in the game palette, wormholes round and Pochven as triangles', () => {
    expect(stepLook(step(1, 'Jita', 0.946))).toEqual({ color: SECURITY_COLORS['0.9'], shape: 'square' });
    expect(stepLook(step(1, 'Null', -0.4))).toEqual({ color: SECURITY_COLORS['0.0'], shape: 'square' });
    expect(stepLook({ whClass: 3, security: -1 }).shape).toBe('round');
    expect(stepLook({ whClass: 25, security: -1 }).shape).toBe('triangle');
    expect(stepLook({ whClass: 7, security: 0.6, invasion: 'edencom' }).shape).toBe('triangle');
    expect(stepClass({ whClass: 12, security: -1 })).toBe('Thera');
    expect(stepClass({ whClass: 8, security: 0.04 })).toBe('0.1');
  });
});

describe('routes section', () => {
  it('lists the map hubs nearest first, with a strip per route and no connection last', async () => {
    const select = section();
    const list = await screen.findByRole('list', { name: 'Routes to map hubs' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Jita3', 'AmarrNo connection']);
    const marks = within(rows[0]!).getAllByRole('button', { name: /Tama|Perimeter|Jita,/ });
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      '0.3 Tama, The Citadel, through a wormhole',
      '0.9 Perimeter, The Forge, by jump bridge',
      '0.9 Jita, The Forge',
    ]);
    fireEvent.pointerEnter(marks[0]!);
    expect(within(rows[0]!).getByRole('tooltip').textContent).toBe('0.3TamaThe Citadelthrough a wormhole');
    // A click on a system on the map selects it; one off the map does nothing.
    fireEvent.click(marks[0]!);
    expect(select).toHaveBeenCalledWith(30002813);
    fireEvent.click(marks[2]!);
    expect(select).toHaveBeenCalledTimes(1);
    expect(queries[0]!.get('from')).toBe('31000001');
    expect(queries[0]!.get('hubs')).toBe('map');
  });

  it('switches to my hubs and remembers the tab', async () => {
    section();
    await screen.findByRole('list', { name: 'Routes to map hubs' });
    await userEvent.click(screen.getByRole('radio', { name: 'My hubs' }));
    expect(await screen.findByText(/No hubs of yours/)).toBeTruthy();
    expect(window.localStorage.getItem('dbk-routes-tab')).toBe('"personal"');
  });

  it('sends the route options with every request and sums them up', async () => {
    section();
    await screen.findByRole('list', { name: 'Routes to map hubs' });
    await userEvent.click(screen.getByRole('button', { name: 'Route options' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'End-of-life holes' }));
    await waitFor(() => expect(queries.at(-1)!.get('skip')).toBe('eol'));
    expect(screen.getByText('no EOL')).toBeTruthy();
  });
});
