// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { LabelDto, SystemIntelDto, UniverseSystemDto } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders } from '../test/setup';
import { MAP_ID, systemFixture } from '../test/fixtures';
import { ToastProvider, TooltipProvider } from '../ui';
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
      <TooltipProvider>
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
      </TooltipProvider>
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

  const intel = (patch: Partial<SystemIntelDto>): SystemIntelDto => ({
    solarSystemId: 31000001,
    sovereignty: null,
    regionHolder: null,
    kills1h: 0,
    npcKills1h: null,
    jumps1h: null,
    lastKillAt: null,
    ...patch,
  });
  const nullSec: UniverseSystemDto = {
    id: 30004759,
    name: '1DQ1-A',
    regionName: 'Delve',
    constellationName: '1-2J4P',
    security: -0.39,
    whClass: 9,
    statics: [],
    effect: null,
  };

  it('shows kills of the last hour before the pilots, coloured only when busy, and nothing without kills', () => {
    const { unmount } = renderNode({ characters: 2, intel: intel({ kills1h: 3 }) });
    const quiet = screen.getByRole('button', { name: '3 kills in the last hour' });
    expect(quiet.textContent).toBe('3');
    expect(quiet.dataset.heat).toBe('active');
    // Kills come first, the pilot count stays last on the row.
    expect(quiet.nextElementSibling?.getAttribute('title')).toBe('2 tracked pilots here');
    unmount();
    const busy = renderNode({ intel: intel({ kills1h: 7 }) });
    expect(screen.getByRole('button', { name: '7 kills in the last hour' }).dataset.heat).toBe('hot');
    expect(busy.container.querySelector('[data-status]')!.getAttribute('title')).toContain(
      'Kills in the last hour: 7',
    );
    busy.unmount();
    renderNode({ intel: intel({ kills1h: 0 }) });
    expect(screen.queryByRole('button', { name: /kills? in the last hour/ })).toBeNull();
  });

  it('puts the holder ticker small in the bottom-right corner, a faction by its short name, nothing in wormholes', () => {
    const { container, unmount } = renderNode({
      info: nullSec,
      system: systemFixture(30004759),
      intel: intel({
        solarSystemId: 30004759,
        sovereignty: {
          kind: 'alliance',
          holder: { id: 1354830081, name: 'Goonswarm Federation', ticker: 'CONDI' },
          corporation: null,
        },
      }),
    });
    const ticker = screen.getByText('[CONDI]');
    expect(ticker.getAttribute('title')).toBe('Sovereignty: Goonswarm Federation [CONDI]');
    // Known space without a custom name names its region on the bottom row.
    expect(screen.getByText('Delve')).toBeTruthy();
    expect(ticker.closest('[data-status]')).toBe(container.querySelector('[data-status]'));
    unmount();
    const faction = renderNode({
      info: { ...nullSec, regionName: 'Stain' },
      system: systemFixture(30004759),
      intel: intel({
        sovereignty: {
          kind: 'faction',
          holder: { id: 500019, name: "Sansha's Nation", ticker: 'Sansha' },
          corporation: null,
        },
      }),
    });
    expect(screen.getByText('Sansha').getAttribute('title')).toBe("Faction space: Sansha's Nation");
    faction.unmount();
    renderNode({ intel: intel({}) });
    expect(screen.queryByText(/^\[/)).toBeNull();
  });

  it('keeps every node as wide as the widest content: the sizer row holds the kills, effect and pilots', () => {
    const { container } = renderNode({ intel: intel({ kills1h: 12 }), characters: 1 });
    const rows = [...container.querySelectorAll<HTMLElement>('[data-status] > div > div')];
    const sizers = rows.find((r) => r.getAttribute('aria-hidden') === 'true')!;
    const shown = rows.find(
      (r) => r.getAttribute('aria-hidden') !== 'true' && r.textContent?.includes('12'),
    )!;
    // The invisible row reserves room for "99" kills and "99" pilots and the effect square ...
    expect(sizers.textContent).toContain('9999');
    expect(sizers.querySelectorAll('svg')).toHaveLength(2);
    // ... while the visible row takes the node's width without adding to it.
    expect(shown.className).toMatch(/fill/);
  });

  it('draws the effect as a small square in its colour and rings softly when a kill comes in', () => {
    const { container } = renderNode({ info: { ...info, effect: 'pulsar' }, pulse: true });
    const dot = container.querySelector<HTMLElement>('[data-effect="pulsar"]')!;
    expect(dot.style.background).toBe('var(--dbk-effect-pulsar)');
    expect(container.querySelector('[data-pulse]')).toBeTruthy();
  });

  it('colours the holder by my standing and gives an unmarked system the status it implies', () => {
    const held = intel({
      sovereignty: {
        kind: 'alliance',
        holder: { id: 1354830081, name: 'Goonswarm Federation', ticker: 'CONDI' },
        corporation: null,
      },
    });
    const { container, unmount } = renderNode({ info: nullSec, intel: held, standing: -10 });
    const node = container.querySelector<HTMLElement>('[data-status]')!;
    expect(screen.getByText('[CONDI]').dataset.standing).toBe('terrible');
    expect(node.dataset.status).toBe('hostile');
    expect(node.dataset.derived).toBe('true');
    expect(node.title).toContain('Hostile from your standing towards the holder');
    unmount();
    // A status someone set wins.
    const marked = renderNode({
      info: nullSec,
      system: systemFixture(31000001, { status: 'friendly' }),
      intel: held,
      standing: -10,
    });
    expect(marked.container.querySelector<HTMLElement>('[data-status]')!.dataset.status).toBe('friendly');
    marked.unmount();
    renderNode({ info: nullSec, intel: held, standing: 10 });
    expect(screen.getByText('[CONDI]').dataset.standing).toBe('excellent');
  });
});
