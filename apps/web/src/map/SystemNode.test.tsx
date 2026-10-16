// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { LabelDto, SystemIntelDto, SystemLabelDto, UniverseSystemDto } from '@darkbeacon/shared';
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

const tag = (id: string, name: string): LabelDto => ({ id, name, color: '#336699', description: '' });
const systemLabel = (id: string, name: string): SystemLabelDto => ({ id, name, description: '' });

function renderNode(data: Partial<SystemNodeData>, connectable = true) {
  const node: SystemNodeType = {
    id: '31000001',
    type: 'system',
    position: { x: 0, y: 0 },
    data: {
      mapId: MAP_ID,
      system: systemFixture(31000001),
      info,
      systemLabels: [],
      tags: [],
      characters: 0,
      ...data,
    },
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
  it('tints the background with the status, with the rest in the tooltip', () => {
    const { container } = renderNode({
      system: systemFixture(31000001, {
        status: 'hostile',
        tag: 'A1',
        description: 'Rattlesnakes',
        locked: true,
      }),
    });
    expect(box(container).dataset.status).toBe('hostile');
    const tint = box(container).style.getPropertyValue('--node-tint-image');
    expect(tint).toContain('linear-gradient(');
    expect(tint).toContain(
      'color-mix(in oklab, var(--dbk-status-hostile) var(--dbk-node-tint-standing), transparent)',
    );
    expect(screen.getByText('C3')).toBeTruthy();
    expect(screen.getByText('J100001')).toBeTruthy();
    // Notes and lock are not on the node, only in its tooltip; the old free-text tag is nowhere.
    expect(screen.queryByText('A1')).toBeNull();
    const title = box(container).title;
    expect(title).toContain('Status: Hostile');
    // A wormhole's region and constellation are codes: not shown.
    expect(title).not.toContain('A-R00001');
    expect(title).not.toContain('A1');
    expect(title).toContain('Locked');
    expect(title).toContain('Notes: Rattlesnakes');
  });

  it('keeps the plain background for systems without a status, and a faint grey once scouted empty', () => {
    const { container, unmount } = renderNode({});
    expect(box(container).style.getPropertyValue('--node-tint-image')).toBe('none');
    unmount();
    const empty = renderNode({ system: systemFixture(31000001, { status: 'empty' }) });
    expect(box(empty.container).style.getPropertyValue('--node-tint-image')).toContain(
      'var(--dbk-status-empty)',
    );
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

  it('shows only where statics lead and puts Labels, custom label, bookmark and Tags above the node', () => {
    const { container } = renderNode({
      system: systemFixture(31000001, { customLabel: 'bait' }),
      info: { ...info, statics: ['D845', 'U210'] },
      bookmark: 'ABC-123',
      systemLabels: [systemLabel('wh1', 'WH1')],
      tags: [tag('a', 'Staging'), tag('b', 'Sites')],
    });
    const statics = screen.getByRole('list', { name: 'Statics' });
    // Only where each static leads on the card; its code is in the tooltip.
    const items = [...statics.querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual(['HS', 'LS']);
    expect(items[0]!.getAttribute('title')).toContain('D845');
    const labels = screen.getByRole('list', { name: 'Labels' });
    expect([...labels.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['WH1', 'bait']);
    const tags = screen.getByRole('list', { name: 'Tags' });
    expect([...tags.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Staging', 'Sites']);
    // Left to right: Labels, the custom label, the bookmark code, Tags; none inside the node's rows.
    const above = labels.parentElement!;
    expect(tags.parentElement).toBe(above);
    const chips = [...above.querySelectorAll('li, button')].map((el) => el.textContent);
    expect(chips).toEqual(['WH1', 'bait', 'ABC-123', 'Staging', 'Sites']);
    // Labels are neutral text markers; only Tags carry a colour.
    expect(labels.querySelector('[style]')).toBeNull();
    expect(tags.querySelector('li')!.getAttribute('style')).toContain('--label-color');
    expect(container.querySelector('[data-status] > [class*="line"]')?.textContent).toBe('HSLS');
  });

  it('shows a custom label alone, without Labels', () => {
    renderNode({ system: systemFixture(31000001, { customLabel: 'scout' }) });
    const labels = screen.getByRole('list', { name: 'Labels' });
    expect(labels.textContent).toBe('scout');
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();
  });

  it('shows the nearest hub under an exit, with a square only for one kind of space', () => {
    const { container, unmount } = renderNode({
      hub: { name: 'Jita', jumps: 4, space: 'high', rules: 'viewer' },
    });
    expect(screen.getByText('Jita 4j')).toBeTruthy();
    // The square is the game's own 0.8 green, no theme's.
    expect((container.querySelector('[data-space="high"]') as HTMLElement).style.background).toBe(
      'rgb(0, 239, 71)',
    );
    expect(screen.getByText('Jita 4j').getAttribute('title')).toMatch(
      /^Nearest hub: Jita, 4 jumps from .+, all in high-sec; with your route options/,
    );
    unmount();
    const mixed = renderNode({ hub: { name: 'Amarr', jumps: 9, space: 'mixed', rules: 'viewer' } });
    expect(screen.getByText('Amarr 9j')).toBeTruthy();
    expect(mixed.container.querySelector('[data-space]')).toBeNull();
    mixed.unmount();
    renderNode({ hub: null });
    expect(screen.queryByText(/\dj$/)).toBeNull();
  });

  it('counts pilots on the right, in the accent colour where I am, with no portraits', () => {
    const { container, unmount } = renderNode({ characters: 3, mine: true });
    const pilots = screen.getByLabelText('3 tracked pilots here, you among them');
    expect(pilots.textContent).toBe('3');
    expect(pilots.dataset.mine).toBe('true');
    expect(container.querySelector('img')).toBeNull();
    unmount();
    renderNode({ characters: 1 });
    expect(screen.getByLabelText('1 tracked pilot here').dataset.mine).toBeUndefined();
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
    const slot = quiet.closest('[data-slot]')!;
    expect(slot.nextElementSibling?.firstElementChild?.getAttribute('aria-label')).toBe(
      '2 tracked pilots here',
    );
    expect(slot.nextElementSibling?.nextElementSibling).toBeNull();
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

  it('hangs the holder below the node on the right, a faction by its short name, nothing in wormholes', () => {
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
    // Below the box, not on it: a chip of the node itself, outside both rows.
    expect(ticker.parentElement).toBe(box(container));
    expect(box(container).querySelector('[class*="line"]')!.textContent).not.toContain('CONDI');
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
    // Under an exit, the hub chip sits on the left of the same row and the holder on the right.
    const exit = renderNode({
      info: nullSec,
      system: systemFixture(30004759),
      hub: { name: 'Dodixie', jumps: 7, space: 'mixed', rules: 'viewer' },
      intel: intel({
        sovereignty: {
          kind: 'alliance',
          holder: { id: 1354830081, name: 'Goonswarm Federation', ticker: 'CONDI' },
          corporation: null,
        },
      }),
    });
    const hubChip = screen.getByText('Dodixie 7j');
    expect(hubChip.parentElement).toBe(box(exit.container));
    expect(hubChip.nextElementSibling).toBe(screen.getByText('[CONDI]'));
    exit.unmount();
    renderNode({ intel: intel({}) });
    expect(screen.queryByText(/^\[/)).toBeNull();
  });

  it('sizes to its own content and keeps live counts in fixed slots on the second row', () => {
    const { container, unmount } = renderNode({ intel: intel({ kills1h: 12 }), characters: 1 });
    const node = box(container);
    // No invisible sizers: nothing in the node is hidden from assistive technology.
    expect(node.querySelector('[aria-hidden="true"]:not(svg)')).toBeNull();
    const head = node.querySelector(':scope > [class*="row"]')!;
    const line = node.querySelector(':scope > [class*="line"]')!;
    expect(head.textContent).not.toContain('12');
    // Kills and pilots sit on the second row, each in a slot of its own.
    const slots = [...line.querySelectorAll<HTMLElement>('[data-slot]')];
    expect(slots.map((s) => s.dataset.slot)).toEqual(['kills', 'pilots']);
    expect(slots[0]!.textContent).toBe('12');
    expect(slots[1]!.textContent).toBe('1');
    unmount();
    // No count, no slot: a quiet empty system takes no room for them.
    const quiet = renderNode({ intel: intel({ kills1h: 0 }), characters: 0 });
    expect(box(quiet.container).querySelector('[data-slot]')).toBeNull();
  });

  it('draws the effect as a small square in its colour and rings softly when a kill comes in', () => {
    const { container } = renderNode({ info: { ...info, effect: 'pulsar' }, pulse: true });
    const dot = container.querySelector<HTMLElement>('[data-effect="pulsar"]')!;
    expect(dot.style.background).toBe('var(--dbk-effect-pulsar)');
    expect(container.querySelector('[data-pulse]')).toBeTruthy();
  });

  describe("the holder's standing, in the game colours", () => {
    const held = intel({
      sovereignty: {
        kind: 'alliance',
        holder: { id: 1354830081, name: 'Goonswarm Federation', ticker: 'CONDI' },
        corporation: null,
      },
    });
    const tintOf = (container: HTMLElement) => box(container).style.getPropertyValue('--node-tint-image');
    const chip = () => screen.getByText('[CONDI]');

    it('tints an unmarked system in my own alliance dark blue (+10), never the green of friendly', () => {
      const { container } = renderNode({ info: nullSec, intel: held, standing: 10 });
      expect(box(container).dataset.status).toBe('unknown');
      expect(box(container).dataset.standingTint).toBe('excellent');
      expect(tintOf(container)).toContain(
        'color-mix(in oklab, var(--dbk-standing-excellent) var(--dbk-node-tint-standing), transparent)',
      );
      expect(tintOf(container)).not.toContain('status-friendly');
      expect(box(container).title).toContain('Tinted by your standing towards the holder: +10 Excellent');
      // The chip below is filled with the game colour itself.
      expect(chip().dataset.standing).toBe('excellent');
      expect(chip().style.getPropertyValue('--sov-color')).toBe('var(--dbk-standing-excellent)');
    });

    it('tints +5 light blue, -5 orange and -10 red, each with its chip', () => {
      for (const [standing, tone] of [
        [5, 'good'],
        [-5, 'bad'],
        [-10, 'terrible'],
      ] as const) {
        const { container, unmount } = renderNode({ info: nullSec, intel: held, standing });
        expect(box(container).dataset.standingTint).toBe(tone);
        expect(tintOf(container)).toContain(`var(--dbk-standing-${tone})`);
        expect(chip().dataset.standing).toBe(tone);
        expect(chip().style.getPropertyValue('--sov-color')).toBe(`var(--dbk-standing-${tone})`);
        unmount();
      }
    });

    it('leaves a neutral holder plain: no tint, a plain chip', () => {
      for (const standing of [0, null]) {
        const { container, unmount } = renderNode({ info: nullSec, intel: held, standing });
        expect(tintOf(container)).toBe('none');
        expect(box(container).dataset.standingTint).toBeUndefined();
        expect(chip().style.getPropertyValue('--sov-color')).toBe('');
        unmount();
      }
    });

    it('lets a status someone set win, friendly and hostile alike, while the chip stays blue', () => {
      for (const status of ['friendly', 'hostile'] as const) {
        const { container, unmount } = renderNode({
          info: nullSec,
          system: systemFixture(31000001, { status }),
          intel: held,
          standing: 10,
        });
        expect(box(container).dataset.status).toBe(status);
        expect(box(container).dataset.standingTint).toBeUndefined();
        expect(tintOf(container)).toContain(`var(--dbk-status-${status})`);
        expect(tintOf(container)).not.toContain('var(--dbk-standing-');
        expect(chip().dataset.standing).toBe('excellent');
        unmount();
      }
    });
  });

  it('marks notes and route hubs in the corner and lists the pilots behind the count on hover', async () => {
    const user = userEvent.setup();
    const { container } = renderNode({
      system: systemFixture(31000001, { description: 'Hostile POS on planet 3' }),
      routeHub: 'map',
      characters: 2,
      mine: true,
      pilots: [
        { id: 1, name: 'Me Myself', ship: 'Loki', mine: true },
        { id: 2, name: 'Other Pilot', ship: null, mine: false },
      ],
    });
    expect(container.querySelector('[data-notes]')!.getAttribute('title')).toBe(
      'Notes: Hostile POS on planet 3',
    );
    expect(container.querySelector('[data-hub="map"]')!.getAttribute('title')).toBe(
      "One of the map's route hubs",
    );
    await user.hover(screen.getByLabelText('2 tracked pilots here, you among them'));
    const list = await screen.findByRole('list', { name: 'Pilots here' });
    expect(list.textContent).toContain('Me MyselfLoki');
    expect(list.textContent).toContain('ship unknown');
  });

  it('draws the padlock for a lock of its own and for one a merged map holds, naming that map', () => {
    const own = renderNode({ system: systemFixture(31000001, { locked: true }) });
    const mine = own.container.querySelector('[data-locked]')!;
    expect(mine.getAttribute('data-locked')).toBe('here');
    expect(mine.getAttribute('title')).toBe('Locked: cannot be moved or removed');
    own.unmount();

    const { container } = renderNode({
      system: systemFixture(31000001, {
        locked: true,
        lockedBy: 'source',
        lockedOn: [{ sourceId: 'a', name: 'Corp A' }],
      }),
    });
    const theirs = container.querySelector('[data-locked]')!;
    expect(theirs.getAttribute('data-locked')).toBe('source');
    expect(theirs.getAttribute('title')).toBe('Locked on Corp A: cannot be moved or removed');
    expect(screen.getByLabelText('Locked on Corp A')).toBeTruthy();
  });

  it('draws no padlock while nothing locks it', () => {
    const { container } = renderNode({ system: systemFixture(31000001) });
    expect(container.querySelector('[data-locked]')).toBeNull();
  });

  it('marks a shattered system after its name and in its tooltip', () => {
    const { container } = renderNode({ info: { ...info, effect: 'redGiant', shattered: true } });
    expect(container.querySelector('[data-shattered]')!.getAttribute('title')).toBe('Shattered system');
    expect(container.querySelector<HTMLElement>('[data-status]')!.title).toContain('Shattered system');
  });
});
