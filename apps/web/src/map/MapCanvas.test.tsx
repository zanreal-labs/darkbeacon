// @vitest-environment jsdom
import { Activity, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { ReactFlowProvider } from '@xyflow/react';
import { routes, type UniverseSystemDto } from '@darkbeacon/shared';
import { META, UNIVERSE } from '../jump/fixtures.test-support';
import { mapPermissions } from '../lib/roles';
import { JumpPage } from '../screens/JumpPage';
import { connectionFixture, MAP_ID, meFixture, systemFixture } from '../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { MapCanvas } from './MapCanvas';
import { emptyMapState, type MapState } from './mapState';

installFlowMocks();
// jsdom has no canvas: the jump planner's star map draws nothing.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const server = setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  http.get(routes.maps.getPreferences.path, () =>
    HttpResponse.json({ viewport: null, bookmarkTemplate: null, bookmarkOrder: null, updatedAt: 0 }),
  ),
  http.get(routes.jumps.universe.path, () => HttpResponse.json(UNIVERSE)),
  // Not what these tests are about: the canvas works without them.
  ...[
    routes.auth.providers.path,
    routes.intel.map.path,
    routes.intel.standings.path,
    routes.jumps.pilot.path,
  ].map((path) => http.get(path, () => new HttpResponse(null, { status: 404 }))),
);

const universe = new Map<number, UniverseSystemDto>(
  [31000001, 31000002].map((id) => [
    id,
    {
      id,
      name: `J${id}`,
      regionName: 'A-R00001',
      constellationName: 'A-C00001',
      security: -0.99,
      whClass: 3,
      statics: [],
      effect: null,
    },
  ]),
);

function chain(): MapState {
  const state = emptyMapState();
  state.systems = new Map([
    [31000001, systemFixture(31000001, { status: 'home' })],
    [31000002, systemFixture(31000002, { position: { x: 360, y: 0 } })],
  ]);
  state.connections = new Map([['c1', connectionFixture('c1', 31000001, 31000002)]]);
  return state;
}

describe('MapCanvas read-only (public view)', () => {
  it('shows the chain without edit controls, menus, account or preferences', async () => {
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => void requests.push(new URL(request.url).pathname));
    const onMenu = vi.fn();
    const store = { moveSystems: vi.fn(), addConnection: vi.fn() };
    const { container } = renderWithProviders(
      <TooltipProvider>
        <ToastProvider>
          <ReactFlowProvider>
            <div style={{ width: 800, height: 600 }}>
              <MapCanvas
                mapId={MAP_ID}
                state={chain()}
                loaded
                labels={[]}
                systemLabels={[]}
                universe={universe}
                can={mapPermissions('viewer')}
                store={store}
                onSelect={() => {}}
                focus={null}
                onMenu={onMenu}
                readOnly
              />
            </div>
          </ReactFlowProvider>
        </ToastProvider>
      </TooltipProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2));
    // Viewing tools stay; what needs an account goes.
    expect(screen.getByRole('button', { name: 'Fit chain (F)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the legend (L)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Center on me (C)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bookmark labels' })).toBeNull();
    // Nothing drags or connects, and right-clicks open nothing.
    const nodes = [...container.querySelectorAll('.react-flow__node')];
    expect(nodes.some((n) => n.classList.contains('draggable'))).toBe(false);
    expect(container.querySelector('.react-flow__handle.connectable')).toBeNull();
    fireEvent.contextMenu(nodes[0]!);
    fireEvent.contextMenu(container.querySelector('.react-flow__pane')!);
    fireEvent.keyDown(window, { key: 'c' });
    expect(onMenu).not.toHaveBeenCalled();
    expect(store.moveSystems).not.toHaveBeenCalled();
    // Neither the account nor the viewer's saved view is asked for.
    expect(requests.filter((p) => p !== '/api/themes')).toEqual([]);
  });
});

/** A chain where real ones are: thousands of pixels away from the origin. */
function farChain(): MapState {
  const state = chain();
  state.systems = new Map(
    [...state.systems].map(([id, s]) => [
      id,
      { ...s, position: { x: s.position.x + 6000, y: s.position.y + 4000 } },
    ]),
  );
  return state;
}

function SignedInMap() {
  return (
    <div style={{ width: 800, height: 600 }}>
      <MapCanvas
        mapId={MAP_ID}
        state={farChain()}
        loaded
        labels={[]}
        systemLabels={[]}
        universe={universe}
        can={mapPermissions('member')}
        store={{ moveSystems: vi.fn(), addConnection: vi.fn() }}
        onSelect={() => {}}
        focus={null}
        onMenu={() => {}}
      />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}

const viewOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? null;

describe('MapCanvas after the jump planner', () => {
  // Next.js keeps a route the viewer left mounted but hidden (React Activity) and shows it again on
  // the way back; React Flow resets its view meanwhile. The map came back at the origin: empty.
  it('shows the chain again when the map was hidden for the jump planner and shown again', async () => {
    const page = (route: 'map' | 'jump') => (
      <Frame>
        <Activity mode={route === 'map' ? 'visible' : 'hidden'}>
          <ReactFlowProvider>
            <SignedInMap />
          </ReactFlowProvider>
        </Activity>
        {route === 'jump' && <JumpPage meta={META} />}
      </Frame>
    );
    const { container, rerender } = renderWithProviders(page('map'));
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2));
    await waitFor(() => expect(viewOf(container)).not.toMatch(/^translate\(0px, ?0px\)/));
    const opened = viewOf(container);

    rerender(page('jump'));
    expect(await screen.findByRole('img', { name: /Star map of known space/ })).toBeTruthy();

    rerender(page('map'));
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2));
    await waitFor(() => expect(viewOf(container)).toBe(opened));
  });

  it('opens on the chain again when the map was unmounted for the jump planner and mounted again', async () => {
    const page = (route: 'map' | 'jump') => (
      <Frame>
        {route === 'map' ? (
          <ReactFlowProvider>
            <SignedInMap />
          </ReactFlowProvider>
        ) : (
          <JumpPage meta={META} />
        )}
      </Frame>
    );
    const { container, rerender } = renderWithProviders(page('map'));
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2));
    await waitFor(() => expect(viewOf(container)).not.toMatch(/^translate\(0px, ?0px\)/));
    const opened = viewOf(container);

    rerender(page('jump'));
    expect(await screen.findByRole('img', { name: /Star map of known space/ })).toBeTruthy();
    expect(container.querySelector('.react-flow')).toBeNull();

    rerender(page('map'));
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2));
    await waitFor(() => expect(viewOf(container)).toBe(opened));
  });
});
