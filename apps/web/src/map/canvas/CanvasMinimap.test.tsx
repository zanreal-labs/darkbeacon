// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider, useReactFlow, type Node, type ReactFlowInstance } from '@xyflow/react';
import { installFlowMocks } from '../../test/setup';
import { CanvasMinimap } from './CanvasMinimap';
import { MINIMAP_SIZE } from './minimapProjection';

installFlowMocks();

const nodes: Node[] = [
  { id: 'a', position: { x: 0, y: 0 }, data: {} },
  { id: 'b', position: { x: 600, y: 300 }, data: {} },
];

function frame() {
  const f = screen.getByTestId('minimap-frame');
  const n = (k: string) => Number(f.getAttribute(k));
  return { cx: n('x') + n('width') / 2, cy: n('y') + n('height') / 2, width: n('width') };
}

const chain = () => screen.getByTestId('minimap-chain').getAttribute('transform');

function setup() {
  const flow: { rf?: ReactFlowInstance } = {};
  function Grab() {
    flow.rf = useReactFlow();
    return null;
  }
  render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={nodes} edges={[]}>
          <Grab />
          <CanvasMinimap corner="bottom-left" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>,
  );
  return flow;
}

describe('CanvasMinimap', () => {
  it('keeps the view frame in the middle and moves the chain under it when the map pans', async () => {
    const flow = setup();
    const before = frame();
    const chainBefore = chain();
    expect(before.cx).toBeCloseTo(MINIMAP_SIZE.width / 2);
    expect(before.cy).toBeCloseTo(MINIMAP_SIZE.height / 2);

    await act(async () => {
      await flow.rf!.setViewport({ x: -500, y: -250, zoom: 1 });
    });

    const after = frame();
    expect(after.cx).toBeCloseTo(MINIMAP_SIZE.width / 2);
    expect(after.cy).toBeCloseTo(MINIMAP_SIZE.height / 2);
    expect(after.width).toBeCloseTo(before.width);
    expect(chain()).not.toBe(chainBefore);
  });

  it('pans the map when the minimap is dragged', async () => {
    const flow = setup();
    const map = screen.getByRole('img', { name: 'Minimap' });
    const start = flow.rf!.getViewport();
    await act(async () => {
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 100, clientY: 70 });
      fireEvent.pointerMove(map, { pointerId: 1, clientX: 120, clientY: 70 });
      fireEvent.pointerUp(map, { pointerId: 1, clientX: 120, clientY: 70 });
    });
    // The chain followed the pointer right, so the view moved left over it.
    expect(flow.rf!.getViewport().x).toBeGreaterThan(start.x);
    expect(frame().cx).toBeCloseTo(MINIMAP_SIZE.width / 2);
  });
});
