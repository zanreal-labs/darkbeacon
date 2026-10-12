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
import { ConnectionEdge, trafficLine, type ConnectionEdgeType } from './ConnectionEdge';

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
const core = (container: HTMLElement) => container.querySelector<SVGPathElement>('[data-layer="mass"]');
const label = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-edge-label]')!;

describe('ConnectionEdge', () => {
  it('draws a healthy wormhole as a thick neutral two-layer line without any text', async () => {
    const { container } = await renderEdge(connectionFixture('c1', 1, 2));
    expect(container.querySelector('[data-underlay="dangerous"]')).toBeNull();
    expect(container.querySelectorAll('[data-bubble]')).toHaveLength(0);
    expect(line(container).style.stroke).toBe('var(--dbk-edge-color)');
    expect(line(container).style.strokeWidth).toBe('var(--dbk-edge-width)');
    expect(core(container)?.style.stroke).toBe('var(--dbk-edge-mass-fresh)');
    // The line runs between the node borders, not their centres.
    expect(line(container).getAttribute('d')).toBe('M 80,30 L 480,30');
    expect(label(container).textContent).toBe('');
  });

  it('shows time outside, mass inside, a halo and bubbles outside both systems; only the size as text', async () => {
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
    expect(halo.getAttribute('d')).toBe('M 80,30 L 480,30');
    // The halo is drawn first, so it sits beneath the line.
    expect(halo.compareDocumentPosition(line(container))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // Centred on the line's ends at the node borders (160 and 400), under the cards.
    const bubbles = [...container.querySelectorAll<SVGCircleElement>('[data-bubble]')];
    expect(bubbles.map((b) => [b.dataset.bubble, b.getAttribute('cx'), b.getAttribute('cy')])).toEqual([
      ['source', '160', '30'],
      ['target', '400', '30'],
    ]);

    expect(line(container).style.stroke).toBe('var(--dbk-edge-time-eol)');
    expect(core(container)?.style.stroke).toBe('var(--dbk-edge-mass-critical)');
    expect(label(container).textContent).toBe('S');
  });

  it('marks only the bubbled end and explains everything on hover', async () => {
    const { container } = await renderEdge(
      connectionFixture('c3', 1, 2, { bubbled: 'target', massStatus: 'reduced', massSaved: true }),
    );
    expect(
      [...container.querySelectorAll<SVGCircleElement>('[data-bubble]')].map((b) => b.dataset.bubble),
    ).toEqual(['target']);
    expect(label(container).textContent).toBe('');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(container.querySelector('.react-flow__edge g')!);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('J100001 ↔ Amamake');
    expect(tip.textContent).toContain('Mass reduced: 10 to 50 % left');
    expect(tip.textContent).toContain('Bubbled on the Amamake side');
    expect(tip.textContent).toContain('Mass saved');
  });

  it('draws gates as one plain line and bridges dotted lime, without text', async () => {
    const gate = await renderEdge(connectionFixture('g', 1, 2, { type: 'gate', shipSize: 'capital' }));
    expect(line(gate.container).style.stroke).toBe('var(--dbk-edge-gate)');
    expect(line(gate.container).style.strokeDasharray).toBe('');
    expect(core(gate.container)).toBeNull();
    expect(label(gate.container).textContent).toBe('');
    gate.unmount();

    const bridge = await renderEdge(connectionFixture('b', 1, 2, { type: 'bridge', shipSize: 'capital' }));
    expect(line(bridge.container).style.stroke).toBe('var(--dbk-edge-bridge)');
    expect(line(bridge.container).style.strokeDasharray).toMatch(/^0\.01 /);
  });
});

describe('the hover card traffic line', () => {
  it('counts the jumps and their mass, and says nothing without any', () => {
    expect(trafficLine({ passages: 3, passed: 445_200_000 })).toBe('3 jumps counted, 445 200 t');
    expect(trafficLine({ passages: 1, passed: 98_400_000 })).toBe('1 jump counted, 98 400 t');
    expect(trafficLine({ passages: 0, passed: 0 })).toBeNull();
    expect(trafficLine(undefined)).toBeNull();
  });
});
