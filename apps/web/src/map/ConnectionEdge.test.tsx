// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node as FlowNode,
} from '@xyflow/react';
import type { ConnectionDto } from '@darkbeacon/shared';
import { connectionFixture, MAP_ID } from '../test/fixtures';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { ConnectionEdge, type ConnectionEdgeType } from './ConnectionEdge';

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
    data: { mapId: MAP_ID, connection, sourceName: 'J100001', targetName: 'Amamake' },
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

const line = (container: HTMLElement) => container.querySelector<SVGPathElement>('.react-flow__edge-path')!;
const badges = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-edge-label] [data-kind]')].map((b) => b.dataset.kind);

describe('ConnectionEdge', () => {
  it('draws a healthy wormhole as a calm plain line without badges', async () => {
    const { container } = await renderEdge(connectionFixture('c1', 1, 2));
    expect(container.querySelector('[data-underlay="dangerous"]')).toBeNull();
    expect(container.querySelectorAll('[data-bubble]')).toHaveLength(0);
    expect(line(container).style.stroke).toBe('var(--dbk-edge-color)');
    expect(line(container).style.strokeWidth).toBe('calc(var(--dbk-edge-width) * 1)');
    expect(line(container).style.strokeDasharray).toBe('');
    // The line runs between the node borders, not their centres.
    expect(line(container).getAttribute('d')).toBe('M 160,30 L 400,30');
    expect(badges(container)).toEqual([]);
  });

  it('shows at most two badges, most urgent first, a halo and bubbles on both ends', async () => {
    const { container } = await renderEdge(
      connectionFixture('c2', 1, 2, {
        timeStatus: 'eol',
        eolAt: Date.now() - 90 * 60_000,
        massStatus: 'critical',
        shipSize: 'small',
        dangerous: true,
        bubbled: 'both',
      }),
    );
    const halo = container.querySelector('[data-underlay="dangerous"]')!;
    expect(halo.getAttribute('d')).toBe('M 160,30 L 400,30');
    // The halo is drawn first, so it sits beneath the line.
    expect(halo.compareDocumentPosition(line(container))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const bubbles = [...container.querySelectorAll<HTMLElement>('[data-bubble]')];
    expect(bubbles.map((b) => [b.dataset.bubble, b.style.transform])).toEqual([
      ['source', 'translate(-50%, -50%) translate(173px, 30px)'],
      ['target', 'translate(-50%, -50%) translate(387px, 30px)'],
    ]);

    expect(line(container).style.stroke).toBe('var(--dbk-edge-mass-critical)');
    expect(line(container).style.strokeDasharray).not.toBe('');
    expect(badges(container)).toEqual(['dangerous', 'eol']);
    expect(screen.getByText(/^EOL ~2h(29|30)m$/)).toBeTruthy();
  });

  it('marks only the bubbled end and explains everything on hover', async () => {
    const { container } = await renderEdge(
      connectionFixture('c3', 1, 2, { bubbled: 'target', massStatus: 'reduced', massSaved: true }),
    );
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-bubble]')].map((b) => b.dataset.bubble),
    ).toEqual(['target']);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(container.querySelector('.react-flow__edge g')!);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('J100001 ↔ Amamake');
    expect(tip.textContent).toContain('Mass reduced: 10 to 50 % left');
    expect(tip.textContent).toContain('Bubbled on the Amamake side');
    expect(tip.textContent).toContain('Mass saved');
  });

  it('draws gates solid with a gate icon and bridges dotted', async () => {
    const gate = await renderEdge(connectionFixture('g', 1, 2, { type: 'gate', shipSize: 'xlarge' }));
    expect(line(gate.container).style.stroke).toBe('var(--dbk-edge-gate)');
    expect(line(gate.container).style.strokeDasharray).toBe('');
    expect(badges(gate.container)).toEqual(['gate']);
    gate.unmount();

    const bridge = await renderEdge(connectionFixture('b', 1, 2, { type: 'bridge', shipSize: 'xlarge' }));
    expect(line(bridge.container).style.stroke).toBe('var(--dbk-edge-bridge)');
    expect(line(bridge.container).style.strokeDasharray).toMatch(/^0\.01 /);
  });
});
