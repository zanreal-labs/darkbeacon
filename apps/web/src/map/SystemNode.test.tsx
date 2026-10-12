// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { LabelDto, UniverseSystemDto } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { MAP_ID, systemFixture } from '../test/fixtures';
import { SystemNode, type SystemNodeData, type SystemNodeType } from './SystemNode';

installFlowMocks();

const info: UniverseSystemDto = {
  id: 31000001,
  name: 'J100001',
  regionName: 'A-R00001',
  constellationName: 'A-C00001',
  security: -0.99,
  whClass: 3,
};

const label: LabelDto = { id: 'l1', name: 'static', color: '#336699', description: 'Home static' };

function renderNode(data: Partial<SystemNodeData>, connectable = true) {
  const node: SystemNodeType = {
    id: '31000001',
    type: 'system',
    position: { x: 0, y: 0 },
    data: { mapId: MAP_ID, system: systemFixture(31000001), info, labels: [], characters: 0, ...data },
  };
  return renderWithProviders(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow
          nodes={[node]}
          edges={[]}
          nodeTypes={{ system: SystemNode }}
          nodesConnectable={connectable}
        />
      </div>
    </ReactFlowProvider>,
  );
}

describe('SystemNode', () => {
  it('shows class, name, tag, status and labels with their description', () => {
    const { container } = renderNode({
      system: systemFixture(31000001, { status: 'hostile', tag: 'A1', labelIds: ['l1'] }),
      labels: [label],
      characters: 2,
    });
    expect(screen.getByText('C3')).toBeTruthy();
    expect(screen.getByText('J100001')).toBeTruthy();
    expect(screen.getByText('A1')).toBeTruthy();
    expect(screen.getByText('A-R00001')).toBeTruthy();
    expect(screen.getByText('static').getAttribute('title')).toBe('static: Home static');
    expect(screen.getByTitle('2 tracked here').textContent).toBe('2');

    const box = container.querySelector<HTMLElement>('[data-status]')!;
    expect(box.dataset.status).toBe('hostile');
    expect(box.style.getPropertyValue('--status-color')).toBe('var(--dbk-status-hostile)');
  });

  it('puts the real name second when a custom name is set, and shows the description and lock icons', () => {
    renderNode({
      system: systemFixture(31000001, { customName: 'Home', description: 'notes', locked: true }),
    });
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('J100001')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Has a description' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Locked' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Hidden' })).toBeNull();
  });

  it('marks hidden systems and falls back to the id while static data loads', () => {
    const { container } = renderNode({
      system: systemFixture(31000001, { visible: false }),
      info: undefined,
    });
    expect(screen.getByText('31000001')).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Hidden' })).toBeTruthy();
    expect(container.querySelector('[data-hidden]')).toBeTruthy();
  });

  it('offers connection handles only when the user may connect', () => {
    const { container, unmount } = renderNode({}, true);
    expect(container.querySelectorAll('.react-flow__handle.connectable')).toHaveLength(4);
    unmount();
    const viewer = renderNode({}, false);
    expect(viewer.container.querySelectorAll('.react-flow__handle.connectable')).toHaveLength(0);
  });
});
