// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { LabelDto, UniverseSystemDto } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { MAP_ID, systemFixture } from '../test/fixtures';
import { ToastProvider } from '../ui';
import { SystemNode, type SystemNodeData, type SystemNodeType } from './SystemNode';

installFlowMocks();

const info: UniverseSystemDto = {
  id: 31000001,
  name: 'J100001',
  regionName: 'A-R00001',
  constellationName: 'A-C00001',
  security: -0.99,
  whClass: 3,
  statics: [],
  effect: null,
};

const label = (id: string, name: string): LabelDto => ({ id, name, color: '#336699', description: '' });

function renderNode(data: Partial<SystemNodeData>, connectable = true) {
  const node: SystemNodeType = {
    id: '31000001',
    type: 'system',
    position: { x: 0, y: 0 },
    data: { mapId: MAP_ID, system: systemFixture(31000001), info, labels: [], characters: 0, ...data },
  };
  return renderWithProviders(
    <ToastProvider>
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow
            nodes={[node]}
            edges={[]}
            nodeTypes={{ system: SystemNode }}
            nodesConnectable={connectable}
          />
        </div>
      </ReactFlowProvider>
    </ToastProvider>,
  );
}

const box = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-status]')!;

describe('SystemNode', () => {
  it('shows the status as the border only, with the rest in the tooltip', () => {
    const { container } = renderNode({
      system: systemFixture(31000001, {
        status: 'hostile',
        tag: 'A1',
        description: 'Rattlesnakes',
        locked: true,
      }),
    });
    expect(box(container).dataset.status).toBe('hostile');
    expect(box(container).style.getPropertyValue('--node-status')).toBe('var(--dbk-status-hostile)');
    expect(screen.getByText('C3')).toBeTruthy();
    expect(screen.getByText('J100001')).toBeTruthy();
    // Tag, notes and lock are not on the node, only in its tooltip.
    expect(screen.queryByText('A1')).toBeNull();
    const title = box(container).title;
    expect(title).toContain('Status: Hostile');
    expect(title).toContain('A-R00001 · A-C00001');
    expect(title).toContain('Tag: A1');
    expect(title).toContain('Locked');
    expect(title).toContain('Notes: Rattlesnakes');
  });

  it('keeps a grey border for systems without a status', () => {
    const { container } = renderNode({});
    expect(box(container).style.getPropertyValue('--node-status')).toBe('var(--dbk-node-border)');
  });

  it('shows a custom name with the real one in the tooltip, and fills known space with its security', () => {
    const { container } = renderNode({
      system: systemFixture(30002537, { customName: 'Staging' }),
      info: { ...info, id: 30002537, name: 'Amamake', whClass: 8, security: 0.38 },
    });
    expect(screen.getByText('Staging')).toBeTruthy();
    expect(box(container).title.split('\n')[0]).toBe('Staging (Amamake)');
    const pill = screen.getByText('0.4');
    expect(pill.dataset.kind).toBe('security');
    expect(pill.style.background).not.toBe('');
  });

  it('writes statics as plain text and puts the bookmark, then labels, above the node', () => {
    const { container } = renderNode({
      info: { ...info, statics: ['D845', 'U210'] },
      bookmark: 'ABC-123',
      labels: [label('a', 'Staging'), label('b', 'Sites')],
    });
    const statics = screen.getByRole('list', { name: 'Statics' });
    expect([...statics.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['D845HS', 'U210LS']);
    const above = screen.getByRole('list', { name: 'Labels' }).parentElement!;
    expect([...above.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Staging', 'Sites']);
    // Labels first, then the bookmark code; neither inside the node's rows.
    expect(above.textContent).toBe('ABC-123StagingSites');
    expect(container.querySelector('[data-status] > [class*="line"]')?.textContent).toBe('D845HSU210LS');
  });

  it('shows the nearest hub under an exit, with a square only for one kind of space', () => {
    const { container, unmount } = renderNode({ hub: { name: 'Jita', jumps: 4, space: 'high' } });
    expect(screen.getByText('Jita 4j')).toBeTruthy();
    expect(container.querySelector('[data-space="high"]')).toBeTruthy();
    unmount();
    const mixed = renderNode({ hub: { name: 'Amarr', jumps: 9, space: 'mixed' } });
    expect(screen.getByText('Amarr 9j')).toBeTruthy();
    expect(mixed.container.querySelector('[data-space]')).toBeNull();
    mixed.unmount();
    renderNode({ hub: null });
    expect(screen.queryByText(/\dj$/)).toBeNull();
  });

  it('counts pilots on the right, in the accent colour where I am, with no portraits', () => {
    const { container, unmount } = renderNode({ characters: 3, mine: true });
    const pilots = screen.getByTitle('3 tracked pilots here, you among them');
    expect(pilots.textContent).toBe('3');
    expect(pilots.dataset.mine).toBe('true');
    expect(container.querySelector('img')).toBeNull();
    unmount();
    renderNode({ characters: 1 });
    expect(screen.getByTitle('1 tracked pilot here').dataset.mine).toBeUndefined();
  });

  it('copies the bookmark label on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderNode({ bookmark: 'ABC-123' });
    await userEvent.click(screen.getByRole('button', { name: 'ABC-123' }));
    expect(writeText).toHaveBeenCalledWith('ABC-123');
    await waitFor(() => expect(screen.getByText('Copied ABC-123')).toBeTruthy());
  });

  it('marks hidden systems and falls back to the id while static data loads', () => {
    const { container } = renderNode({
      system: systemFixture(31000001, { visible: false }),
      info: undefined,
    });
    expect(screen.getByText('31000001')).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
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
