// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node as FlowNode,
} from '@xyflow/react';
import type { ConnectionDto } from '@wormwright/shared';
import { connectionFixture, MAP_ID } from '../test/fixtures';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { ConnectionEdge, strokeToken, type ConnectionEdgeType } from './ConnectionEdge';

installFlowMocks();

/** Stands in for the system node: a box with a handle, as the canvas uses loose connections. */
function Box() {
  return (
    <div style={{ width: 160, height: 60 }}>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodes: FlowNode[] = [
  { id: '1', type: 'box', position: { x: 0, y: 0 }, data: {} },
  { id: '2', type: 'box', position: { x: 400, y: 0 }, data: {} },
];

async function renderEdge(connection: ConnectionDto, selected = false) {
  const edge: ConnectionEdgeType = {
    id: connection.id,
    type: 'connection',
    source: '1',
    target: '2',
    selected,
    data: { mapId: MAP_ID, connection },
  };
  const result = renderWithProviders(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow
          nodes={nodes}
          edges={[edge]}
          nodeTypes={{ box: Box }}
          edgeTypes={{ connection: ConnectionEdge }}
          connectionMode={ConnectionMode.Loose}
        />
      </div>
    </ReactFlowProvider>,
  );
  await waitFor(() => expect(result.container.querySelector('.react-flow__edge-path')).toBeTruthy());
  return result;
}

describe('ConnectionEdge', () => {
  it('draws a plain fresh wormhole without extras', async () => {
    const { container } = await renderEdge(connectionFixture('c1', 1, 2));
    expect(container.querySelector('[data-underlay]')).toBeNull();
    expect(container.querySelectorAll('[data-bubble]')).toHaveLength(0);
    const path = container.querySelector<SVGPathElement>('.react-flow__edge-path')!;
    expect(path.style.stroke).toBe('var(--ww-edge-color)');
    expect(path.style.strokeDasharray).toBe('');
    // The line runs between the node borders, not their centres.
    expect(path.getAttribute('d')).toBe('M 160,30 L 400,30');
    expect(screen.getByText('L')).toBeTruthy();
  });

  it('shows time, mass and size, a dangerous underlay and bubbles at both ends', async () => {
    const { container } = await renderEdge(
      connectionFixture('c2', 1, 2, {
        timeStatus: 'eol',
        eolAt: Date.now() - 90 * 60_000,
        massStatus: 'critical',
        shipSize: 'medium',
        dangerous: true,
        bubbled: 'both',
        massSaved: true,
      }),
    );
    const underlay = container.querySelector('[data-underlay="dangerous"]')!;
    expect(underlay.getAttribute('d')).toBe('M 160,30 L 400,30');
    // The underlay is drawn first, so it sits beneath the line.
    expect(underlay.compareDocumentPosition(container.querySelector('.react-flow__edge-path')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    const bubbles = [...container.querySelectorAll<SVGCircleElement>('[data-bubble]')];
    expect(bubbles.map((b) => [b.dataset.bubble, b.getAttribute('cx')])).toEqual([
      ['source', '169'],
      ['target', '391'],
    ]);

    const path = container.querySelector<SVGPathElement>('.react-flow__edge-path')!;
    expect(path.style.stroke).toBe('var(--ww-edge-mass-critical)');
    expect(path.style.strokeDasharray).not.toBe('');
    expect(screen.getByText('EOL 1h30m')).toBeTruthy();
    expect(screen.getByText('critical')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('saved')).toBeTruthy();
  });

  it('marks only the bubbled end', async () => {
    const { container } = await renderEdge(connectionFixture('c3', 1, 2, { bubbled: 'target' }));
    expect([...container.querySelectorAll<SVGElement>('[data-bubble]')].map((b) => b.dataset.bubble)).toEqual(
      ['target'],
    );
  });
});

describe('strokeToken', () => {
  it('colours by type first, then by mass, and selection wins', () => {
    const c = connectionFixture('c', 1, 2);
    expect(strokeToken(c)).toBe('edge-color');
    expect(strokeToken({ ...c, massStatus: 'reduced' })).toBe('edge-mass-reduced');
    expect(strokeToken({ ...c, type: 'gate', massStatus: 'critical' })).toBe('edge-gate');
    expect(strokeToken({ ...c, type: 'bridge' })).toBe('edge-bridge');
    expect(strokeToken(c, true)).toBe('edge-selected');
  });
});
