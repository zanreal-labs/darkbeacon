// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { routes, type JumpPlanDto, type JumpShareViewDto } from '@darkbeacon/shared';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { ARK, UNIVERSE } from './fixtures.test-support';
import { SharedJumpView } from './SharedJumpView';

installFlowMocks({ width: 1200, height: 800 });
// jsdom has no canvas: the map draws nothing, the panel still shows.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const ref = (i: number) => ({
  id: UNIVERSE.systems.id[i]!,
  name: UNIVERSE.systems.name[i]!,
  security: UNIVERSE.systems.security[i]!,
  region: 'Domain',
  station: false,
});
const leg = {
  kind: 'jump' as const,
  ly: 9,
  fuel: 30_000,
  bridgeFuel: null,
  waitMinutes: 0,
  activationMinutes: 2,
  fatigueMinutes: 20,
};
const plan: JumpPlanDto = {
  ship: { ...ARK, bridges: false, highSec: true, ansiblex: true, cyno: 'industrial' },
  rangeLy: 10,
  route: {
    legs: [
      { ...leg, from: ref(1), to: ref(2), stop: true },
      { ...leg, from: ref(2), to: ref(3), stop: false },
    ],
    jumps: 2,
    gates: 0,
    ansiblex: 0,
    ly: 18,
    fuel: 60_000,
    bridgeFuel: null,
    waitMinutes: 2,
    fatigueMinutes: 30,
    activationMinutes: 2,
    notes: [],
    best: [],
  },
  alternatives: [],
  problem: null,
  ignoredAnsiblex: [],
};
const view: JumpShareViewDto = {
  request: {
    shipTypeId: ARK.typeId,
    origin: 30002647,
    destination: 30005035,
    via: [30005196],
    roundTrip: false,
    skills: { jdc: 4, jfc: 3, jf: 2 },
    avoidSystems: [],
    avoidRegions: [],
    preferStations: false,
    gates: 'finish',
    outlaw: false,
    ansiblex: [],
    maxFatigueMinutes: null,
    fatigueNowMinutes: 0,
    bridgeTonnes: null,
  },
  plan,
  fuelPrices: {
    hub: 'jita',
    station: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    prices: { helium: 700, hydrogen: 616, nitrogen: 650, oxygen: 690 },
    fetchedAt: 0,
  },
  universeVersion: UNIVERSE.version,
  sharedAt: 0,
};

setupMockServer(http.get(routes.public.jumpUniverse.path, () => HttpResponse.json(UNIVERSE)));

describe('SharedJumpView', () => {
  it('shows the shared route read-only: stops, legs, levels and the fuel at the hub', async () => {
    renderWithProviders(
      <TooltipProvider>
        <ToastProvider>
          <SharedJumpView view={view} />
        </ToastProvider>
      </TooltipProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Ignoitton > Ahbazon > Ami' })).toBeTruthy();
    const panel = screen.getByRole('complementary', { name: 'Shared jump route' });
    expect(within(panel).getByText(/JDC IV · JFC III · JF II/)).toBeTruthy();
    expect(within(panel).getByText('stop')).toBeTruthy();
    expect(within(panel).getByText(/≈ 42M ISK · Jita/)).toBeTruthy();
    // Nothing edits here; the planner is a link away (with the stops in the address).
    expect(within(panel).queryByRole('combobox')).toBeNull();
    const open = within(panel).getByRole('link', { name: 'Open in the planner' });
    expect(open.getAttribute('href')).toBe('/jump?from=Ignoitton&to=Ami&ship=Ark&via=Ahbazon');
  });
});
