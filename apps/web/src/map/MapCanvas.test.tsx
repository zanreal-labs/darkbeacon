// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { UniverseSystemDto } from '@darkbeacon/shared';
import { mapPermissions } from '../lib/roles';
import { connectionFixture, MAP_ID, systemFixture } from '../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { MapCanvas } from './MapCanvas';
import { emptyMapState, type MapState } from './mapState';

installFlowMocks();
const server = setupMockServer();

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
