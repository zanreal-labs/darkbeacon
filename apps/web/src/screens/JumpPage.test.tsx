// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes, type JumpPlanDto, type JumpPlanRequest, type MyTrackingDto } from '@darkbeacon/shared';
import { ARK, META, UNIVERSE } from '../jump/fixtures.test-support';
import { meFixture } from '../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { JumpPage } from './JumpPage';
import type { PlannerMap } from './JumpPlannerClient';

installFlowMocks({ width: 1200, height: 800 });
// jsdom has no canvas: the map draws nothing, the controls still work.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const requests: JumpPlanRequest[] = [];
const ref = (i: number) => ({
  id: UNIVERSE.systems.id[i]!,
  name: UNIVERSE.systems.name[i]!,
  security: UNIVERSE.systems.security[i]!,
  region: 'Domain',
  station: false,
});
const plan: JumpPlanDto = {
  ship: ARK,
  rangeLy: 10,
  route: {
    legs: [
      {
        kind: 'jump',
        from: ref(1),
        to: ref(2),
        ly: 9.95,
        fuel: 31_524,
        bridgeFuel: null,
        waitMinutes: 0,
        activationMinutes: 2,
        fatigueMinutes: 19.9,
      },
      {
        kind: 'jump',
        from: ref(2),
        to: ref(3),
        ly: 8.17,
        fuel: 25_884,
        bridgeFuel: null,
        waitMinutes: 2,
        activationMinutes: 2,
        fatigueMinutes: 32.2,
      },
    ],
    jumps: 2,
    gates: 0,
    ansiblex: 0,
    ly: 18.12,
    fuel: 57_408,
    bridgeFuel: null,
    waitMinutes: 2,
    fatigueMinutes: 32.2,
    activationMinutes: 2,
    notes: [],
  },
  problem: null,
  ignoredAnsiblex: [],
};

setupMockServer(
  http.get(routes.jumps.universe.path, () => HttpResponse.json(UNIVERSE)),
  http.post(routes.jumps.plan.path, async ({ request }) => {
    requests.push((await request.json()) as JumpPlanRequest);
    return HttpResponse.json(plan);
  }),
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  // Ayla Vex (online) sits in Ignoitton.
  http.get(routes.characters.myTracking.path, () =>
    HttpResponse.json({
      characters: [
        {
          characterId: 3_900_000_001,
          solarSystemId: 30002647,
          shipTypeId: null,
          shipName: null,
          online: true,
          docked: false,
          updatedAt: 0,
          trackedOn: [],
        },
      ],
      maps: [],
    } satisfies MyTrackingDto),
  ),
);

/** The demo chain: Ahbazon is an exit, Ami a known-space system on it (and a wormhole). */
const CHAIN: PlannerMap = { map: 'Home chain', exits: [30005196], systems: [31002531, 30005196, 30005035] };

function renderPage(chain: PlannerMap | null = null) {
  return renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <JumpPage meta={META} chain={chain} />
      </ToastProvider>
    </TooltipProvider>,
  );
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('JumpPage', () => {
  beforeEach(() => {
    requests.length = 0;
    window.localStorage.clear();
    window.history.replaceState(null, '', '/jump');
  });

  it('renders the star map and the controls, and plans once start and destination are set', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('img', { name: /Star map of known space/ })).toBeTruthy();
    const panel = screen.getByRole('complementary', { name: 'Jump planner' });
    expect(within(panel).getByText(/10 ly range/)).toBeTruthy();
    expect(within(panel).getByText('Search for a start, or click a system on the map.')).toBeTruthy();

    await user.type(within(panel).getAllByRole('combobox')[2]!, 'Ignoi');
    await user.click(await screen.findByRole('option', { name: /Ignoitton/ }));
    await user.type(within(panel).getAllByRole('combobox')[2]!, 'Ami');
    await user.click(await screen.findByRole('option', { name: /Ami/ }));

    const route = await screen.findByRole('region', { name: 'Route' });
    expect(within(route).getByText('57,408 helium')).toBeTruthy();
    expect(within(route).getAllByRole('listitem')).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      shipTypeId: ARK.typeId,
      origin: 30002647,
      destination: 30005035,
      skills: { jdc: 5, jfc: 4, jf: 4 },
      gates: 'finish',
    });
    await waitFor(() => expect(window.location.search).toBe('?from=Ignoitton&to=Ami&ship=Ark'));
  });

  it('suggests where my characters are and the chain as search results, on focus', async () => {
    const user = userEvent.setup();
    renderPage(CHAIN);
    const panel = await screen.findByRole('complementary', { name: 'Jump planner' });
    const [start, destination] = within(panel).getAllByRole('combobox').slice(2);

    await user.click(start!);
    await waitFor(() => expect(optionNames()[0]).toMatch(/^Ignoitton.*Ayla Vex/));
    expect(optionNames()).toEqual([
      expect.stringMatching(/^Ignoitton.*Ayla Vex/),
      expect.stringMatching(/^Ahbazon.*Chain exit/),
      expect.stringMatching(/^Ami.*On the map/),
    ]);
    await user.click(screen.getByRole('option', { name: /Ignoitton/ }));

    // The destination offers the map first (the start left out), and typing keeps it first.
    await user.click(destination!);
    await waitFor(() =>
      expect(optionNames()).toEqual([
        expect.stringMatching(/^Ahbazon.*Chain exit/),
        expect.stringMatching(/^Ami.*On the map/),
      ]),
    );
    await user.type(destination!, 'a');
    // The suggestions stay listed until the answer for "a" replaces them.
    await waitFor(() =>
      expect(optionNames()).toEqual([
        expect.stringMatching(/^Ahbazon.*Chain exit/),
        expect.stringMatching(/^Ami.*On the map/),
        expect.stringMatching(/^Jita/),
      ]),
    );
  });

  it('swaps start and destination in one step, keeping focus and the sheet', async () => {
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Jump planner' });
    await screen.findByRole('region', { name: 'Route' });
    const swap = within(panel).getByRole('button', { name: 'Swap start and destination' });
    await user.click(swap);
    const start = panel.querySelector('[data-picker="origin"]')!;
    const destination = panel.querySelector('[data-picker="destination"]')!;
    expect(start.textContent).toMatch(/Ami/);
    expect(destination.textContent).toMatch(/Ignoitton/);
    expect(document.activeElement).toBe(swap);
    await waitFor(() => expect(window.location.search).toBe('?from=Ami&to=Ignoitton&ship=Ark'));
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ origin: 30005035, destination: 30002647 }));
    // With only a destination, a swap makes it the start.
    await user.click(within(start as HTMLElement).getByRole('button', { name: 'Choose another' }));
    await user.click(swap);
    expect(start.textContent).toMatch(/Ignoitton/);
    expect(destination.querySelector('input')).toBeTruthy();
    expect(document.activeElement).toBe(swap);
  });

  it('starts from the address and clears with Escape', async () => {
    window.history.replaceState(null, '', '/jump?from=Jita&to=Ami&ship=Avatar');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Jump planner' });
    expect(within(panel).getByText(/6 ly range/)).toBeTruthy();
    await screen.findByRole('region', { name: 'Route' });
    expect(requests[0]).toMatchObject({ shipTypeId: 11567, origin: 30000142, destination: 30005035 });
    await user.keyboard('{Escape}');
    expect(await within(panel).findByText('Search for a start, or click a system on the map.')).toBeTruthy();
  });
});
