// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { routes, type JumpPlanDto, type JumpPlanRequest } from '@darkbeacon/shared';
import { ARK, META, UNIVERSE } from '../jump/fixtures.test-support';
import { meFixture } from '../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { JumpPage } from './JumpPage';

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
);

function renderPage() {
  return renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <JumpPage meta={META} />
      </ToastProvider>
    </TooltipProvider>,
  );
}

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
