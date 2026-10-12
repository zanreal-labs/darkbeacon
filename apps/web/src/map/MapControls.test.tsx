// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { TooltipProvider } from '../ui';
import { MapControls } from './MapControls';

installFlowMocks();

function Harness({
  hasSelection,
  onFit,
  onFitSelection,
}: {
  hasSelection: boolean;
  onFit(): void;
  onFitSelection(): void;
}) {
  const [legend, setLegend] = useState(false);
  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodes={[]} edges={[]}>
            <MapControls
              onFit={onFit}
              onFitSelection={onFitSelection}
              hasSelection={hasSelection}
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
  it('fits the map, and the selection only when there is one', async () => {
    const onFit = vi.fn();
    const onFitSelection = vi.fn();
    const { rerender } = renderWithProviders(
      <Harness hasSelection={false} onFit={onFit} onFitSelection={onFitSelection} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fit the map' }));
    expect(onFit).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Fit the selection' }).hasAttribute('disabled')).toBe(true);

    rerender(<Harness hasSelection onFit={onFit} onFitSelection={onFitSelection} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fit the selection' }));
    expect(onFitSelection).toHaveBeenCalledOnce();
  });

  it('toggles the connection legend, and Escape closes it', async () => {
    renderWithProviders(<Harness hasSelection={false} onFit={() => {}} onFitSelection={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Connection legend' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show the legend' }));
    const legend = screen.getByRole('region', { name: 'Connection legend' });
    expect(legend.textContent).toContain('End of life (under 4 h)');
    expect(legend.textContent).toContain('Bubbled at that end');
    expect(screen.getByRole('button', { name: 'Hide the legend' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Connection legend' })).toBeNull();
  });
});
