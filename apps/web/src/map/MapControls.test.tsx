// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { mapPermissions } from '../lib/roles';
import { MAP_ID } from '../test/fixtures';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { TooltipProvider } from '../ui';
import { edgeInnerStyle, edgeOuterStyle, edgeVisual } from './edgeStyle';
import { LEGEND_EDGE_STATES, LEGEND_NOW } from './MapLegend';
import { MapControls } from './MapControls';

installFlowMocks();

function Harness({ onFit, onCenterMe }: { onFit(): void; onCenterMe(): void }) {
  const [legend, setLegend] = useState(false);
  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodes={[]} edges={[]}>
            <MapControls
              mapId={MAP_ID}
              can={mapPermissions('member')}
              onFit={onFit}
              onCenterMe={onCenterMe}
              located
              legend={legend}
              onLegend={setLegend}
            />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </TooltipProvider>
  );
}

describe('MapControls', () => {
  it('fits the chain and centres on me', async () => {
    const onFit = vi.fn();
    const onCenterMe = vi.fn();
    renderWithProviders(<Harness onFit={onFit} onCenterMe={onCenterMe} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fit chain (F)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Center on me (C)' }));
    expect(onFit).toHaveBeenCalledOnce();
    expect(onCenterMe).toHaveBeenCalledOnce();
  });

  it('toggles the legend, which draws every state exactly like the edge, and Escape closes it', async () => {
    renderWithProviders(<Harness onFit={() => {}} onCenterMe={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Map legend' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show the legend (L)' }));
    const legend = screen.getByRole('region', { name: 'Map legend' });
    expect(legend.textContent).toContain('end of life (under 4 h)');
    expect(legend.textContent).toContain('under an hour left');
    expect(legend.textContent).toContain('bubbled at that end');
    expect(legend.textContent).toContain('Target');

    const samples = [...legend.querySelectorAll<HTMLElement>('[data-legend-edge]')];
    expect(samples).toHaveLength(LEGEND_EDGE_STATES.length);
    LEGEND_EDGE_STATES.forEach((state, i) => {
      const v = edgeVisual(state.connection, LEGEND_NOW);
      const outer = edgeOuterStyle(v);
      const line = samples[i]!.querySelector<SVGPathElement>('[data-line]')!;
      expect(line.style.stroke).toBe(outer.stroke);
      expect(line.style.strokeWidth).toBe(outer.strokeWidth);
      expect(line.style.strokeDasharray).toBe(outer.strokeDasharray ?? '');
      expect(samples[i]!.querySelector<SVGPathElement>('[data-core]')?.style.stroke).toBe(
        edgeInnerStyle(v)?.stroke,
      );
    });
    expect(legend.querySelectorAll('[data-legend-status]')).toHaveLength(8);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Map legend' })).toBeNull();
  });
});
