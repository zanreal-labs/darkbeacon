// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import {
  DEFAULT_ROUTE_PREFERENCES,
  routes,
  type BridgeDto,
  type CharacterDto,
  type JumpFuelPricesDto,
  type KnownStructuresDto,
  type JumpPilotDto,
  type JumpPlanDto,
  type JumpPlanRequest,
  type MapIntelDto,
  type MyTrackingDto,
  type RouteDto,
  type RouteStepDto,
  type StandingsDto,
  type SystemIntelDto,
  type WaypointRequest,
} from '@darkbeacon/shared';
import { ARK, META, UNIVERSE } from '../jump/fixtures.test-support';
import { SETTINGS_KEY } from '../jump/settings';
import { meFixture } from '../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { JumpPage } from './JumpPage';
import type { PlannerMap } from './JumpPlannerClient';

installFlowMocks({ width: 1200, height: 800 });
// jsdom has no canvas: the map draws nothing, the controls still work.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
// Radix measures, scrolls and captures the pointer in selects, which jsdom cannot.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

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
        stop: false,
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
        stop: false,
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
    best: [],
  },
  alternatives: [],
  problem: null,
  ignoredAnsiblex: [],
};

const AYLA = 3_900_000_001;
/** Ayla Vex linked before the planner asked for skills and fatigue. */
const withoutExtra: JumpPilotDto = {
  characterId: AYLA,
  skills: null,
  fatigueMinutes: null,
  fatigueExpiresAt: null,
  missingScopes: ['esi-skills.read_skills.v1', 'esi-characters.read_fatigue.v1'],
  problem: null,
  checkedAt: 0,
};

const server = setupMockServer(
  http.get(routes.jumps.universe.path, () => HttpResponse.json(UNIVERSE)),
  http.get(routes.jumps.pilot.path, () => HttpResponse.json(withoutExtra)),
  http.post(routes.jumps.plan.path, async ({ request }) => {
    requests.push((await request.json()) as JumpPlanRequest);
    return HttpResponse.json(plan);
  }),
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  // No maps (so no Ansiblex), no standings and nobody holding the route's systems by default.
  http.get(routes.maps.list.path, () => HttpResponse.json([])),
  // NPC stations and structures of the route's systems: Ami has one public Astrahus.
  http.get(routes.routing.structures.path, () =>
    HttpResponse.json({
      structures: [
        {
          id: 1_035_000_000_001,
          name: 'Ami - Haulers Rest',
          solarSystemId: 30005035,
          typeId: 35832,
          typeName: 'Astrahus',
          owner: { id: 98_000_001, name: 'Freight Co', ticker: 'FRGT' },
          source: 'public',
        },
      ],
      access: null,
    } satisfies KnownStructuresDto),
  ),
  http.get(routes.intel.standings.path, () =>
    HttpResponse.json({ standings: [], missingScopes: false, overrides: [] } satisfies StandingsDto),
  ),
  http.get(routes.intel.systems.path, () =>
    HttpResponse.json({ systems: [], live: false } satisfies MapIntelDto),
  ),
  // No price unless a test says otherwise: the summary shows the isotopes alone.
  http.get(routes.jumps.fuelPrices.path, () => new HttpResponse(null, { status: 503 })),
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
const CHAIN: PlannerMap = {
  id: 'm-home',
  map: 'Home chain',
  exits: [30005196],
  systems: [31002531, 30005196, 30005035],
};

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
    const panel = screen.getByRole('complementary', { name: 'Planner' });
    expect(within(panel).getByRole('button', { name: 'Skills' })).toBeTruthy();
    expect(within(panel).queryByRole('region', { name: 'Route' })).toBeNull();

    await user.type(within(panel).getAllByRole('combobox')[2]!, 'Ignoi');
    await user.click(await screen.findByRole('option', { name: /Ignoitton/ }));
    await user.type(within(panel).getAllByRole('combobox')[2]!, 'Ami');
    await user.click(await screen.findByRole('option', { name: /Ami/ }));

    const route = await screen.findByRole('region', { name: 'Route' });
    // Without a fuel price the totals over the map count the isotopes.
    expect(
      within(screen.getByRole('region', { name: 'Route totals' })).getByText(/57,408 helium/),
    ).toBeTruthy();
    // Every leg shows in the trip's own list: the system between, then the destination's card.
    expect(route).toBeTruthy();
    expect(panel.querySelectorAll('[data-leg]')).toHaveLength(2);
    // Where one can dock: Ami's card counts its public Astrahus and names it on hover.
    const ami = await within(panel).findByTitle('Haulers Rest', undefined, { timeout: 3000 });
    expect(ami.textContent).toBe('Docks1');
    expect(requests[0]).toMatchObject({
      shipTypeId: ARK.typeId,
      origin: 30002647,
      destination: 30005035,
      skills: { jdc: 5, jfc: 4, jf: 4 },
      gates: 'never',
    });
    await waitFor(() => expect(window.location.search).toBe('?from=Ignoitton&to=Ami&ship=Ark'));
  });

  it('suggests where my characters are and the chain as search results, on focus', async () => {
    const user = userEvent.setup();
    renderPage(CHAIN);
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    const [start, destination] = within(panel).getAllByRole('combobox').slice(2);

    await user.click(start!);
    await waitFor(() => expect(optionNames()[0]).toMatch(/Ignoitton.*Ayla Vex/));
    expect(optionNames()).toEqual([
      expect.stringMatching(/Ignoitton.*Ayla Vex/),
      expect.stringMatching(/Ahbazon.*Chain exit/),
      expect.stringMatching(/Ami.*On the map/),
    ]);
    await user.click(screen.getByRole('option', { name: /Ignoitton/ }));

    // The destination offers the map first (the start left out), and typing keeps it first.
    await user.click(destination!);
    await waitFor(() =>
      expect(optionNames()).toEqual([
        expect.stringMatching(/Ahbazon.*Chain exit/),
        expect.stringMatching(/Ami.*On the map/),
      ]),
    );
    await user.type(destination!, 'a');
    // The suggestions stay listed until the answer for "a" replaces them.
    await waitFor(() =>
      expect(optionNames()).toEqual([
        expect.stringMatching(/Ahbazon.*Chain exit/),
        expect.stringMatching(/Ami.*On the map/),
        expect.stringMatching(/Jita/),
      ]),
    );
  });

  it('marks systems held by someone neither mine nor blue', async () => {
    const held = (solarSystemId: number, id: number, ticker: string): SystemIntelDto => ({
      solarSystemId,
      sovereignty: { kind: 'alliance', holder: { id, name: ticker, ticker }, corporation: null },
      regionHolder: null,
      kills1h: 0,
      npcKills1h: null,
      jumps1h: null,
      lastKillAt: null,
    });
    server.use(
      // Ahbazon (between) is held by a red alliance, Ami (the destination) by a blue one.
      http.get(routes.intel.systems.path, () =>
        HttpResponse.json({
          systems: [held(30005196, 99_000_001, 'RED'), held(30005035, 99_000_002, 'BLUE')],
          live: false,
        } satisfies MapIntelDto),
      ),
      http.get(routes.intel.standings.path, () =>
        HttpResponse.json({
          standings: [
            { id: 99_000_001, standing: -10 },
            { id: 99_000_002, standing: 10 },
          ],
          missingScopes: false,
          overrides: [],
        } satisfies StandingsDto),
      ),
    );
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    const red = await within(panel).findByText('RED');
    expect(red.getAttribute('data-tone')).toBe('terrible');
    expect(within(panel).queryByText('BLUE')).toBeNull();
  });

  it('takes stargates only into high-sec, where no cyno can be lit', async () => {
    // Old saves that asked for gates do not matter any more.
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gates: 'shortcut' }));
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Route' });
    expect(requests.at(-1)).toMatchObject({ gates: 'never' });
    unmount();

    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Jita&ship=Ark');
    renderPage();
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ destination: 30000142, gates: 'finish' }));
  });

  it('takes no Ansiblex bridges unless the pilot turns them on', async () => {
    const end = (solarSystemId: number, name: string) => ({
      solarSystemId,
      name,
      security: -0.2,
      regionName: 'Delve',
    });
    const bridge: BridgeDto = {
      id: 'b1',
      a: end(30004759, '1DQ1-A'),
      b: end(30004760, 'T5ZI-S'),
      dangerous: false,
      source: 'esi',
      structureName: null,
      structureId: null,
      ownerCorporationId: null,
      ownerAllianceId: null,
      createdAt: 0,
    };
    server.use(
      http.get(routes.maps.list.path, () =>
        HttpResponse.json([{ id: 'm-home', slug: 'home', name: 'Home chain', role: 'admin' }]),
      ),
      http.get(routes.bridges.list.path, () => HttpResponse.json([bridge])),
    );
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    renderPage();
    await screen.findByRole('region', { name: 'Route' });
    expect(requests.at(-1)).toMatchObject({ ansiblex: [] });

    await user.click(screen.getByRole('button', { name: 'Route options' }));
    const use = screen.getByRole('switch', { name: 'Use Ansiblex bridges' });
    expect(use.getAttribute('aria-checked')).toBe('false');
    await user.click(use);
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({ ansiblex: [{ from: 30004759, to: 30004760 }] }),
    );
  });

  it('adds the next destination at the bottom, and may end where it started', async () => {
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    await screen.findByRole('region', { name: 'Route' });
    // Ami becomes the stop; an empty destination waits under it.
    await user.click(within(panel).getByRole('button', { name: 'Add stop' }));
    expect(panel.querySelector('[data-picker="stop"]')!.textContent).toMatch(/Ami/);
    const destination = panel.querySelector<HTMLInputElement>('[data-picker="destination"] input')!;
    expect(destination.value).toBe('');
    // Back to the start: Ignoitton > Ami > Ignoitton.
    await user.type(destination, 'Ignoi');
    await user.click(await screen.findByRole('option', { name: /Ignoitton/ }));
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({ origin: 30002647, via: [30005035], destination: 30002647 }),
    );
    expect(panel.querySelector('[data-picker="origin"]')!.textContent).toMatch(/Ignoitton/);
  });

  it('reverses the route by moving the start below the destination; no swap button', async () => {
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    await screen.findByRole('region', { name: 'Route' });
    expect(within(panel).queryByRole('button', { name: /Swap/ })).toBeNull();
    // "Add stop" sits under the trip (its stop goes before the destination).
    const rows = [...panel.querySelectorAll('[data-picker], button')];
    const add = within(panel).getByRole('button', { name: 'Add stop' });
    expect(rows.indexOf(panel.querySelector('[data-picker="destination"]')!)).toBeLessThan(rows.indexOf(add));
    within(panel)
      .getByRole('button', { name: /Move start/ })
      .focus();
    await user.keyboard('{ArrowDown}');
    const start = panel.querySelector('[data-picker="origin"]')!;
    const destination = panel.querySelector('[data-picker="destination"]')!;
    expect(start.textContent).toMatch(/Ami/);
    expect(destination.textContent).toMatch(/Ignoitton/);
    await waitFor(() => expect(window.location.search).toBe('?from=Ami&to=Ignoitton&ship=Ark'));
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ origin: 30005035, destination: 30002647 }));
  });

  it('fills skills and fatigue from ESI for my main; a manual edit wins until refresh', async () => {
    let asked = 0;
    server.use(
      http.get(routes.jumps.pilot.path, ({ params }) => {
        asked++;
        return HttpResponse.json({
          characterId: Number(params.characterId),
          skills: { jdc: 4, jfc: 5, jf: 2 },
          fatigueMinutes: 42,
          fatigueExpiresAt: Date.now() + 42 * 60_000,
          missingScopes: [],
          problem: null,
          checkedAt: Date.now(),
        } satisfies JumpPilotDto);
      }),
    );
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    // Folded away under its name; open, the range and where the levels come from.
    const skills = await within(panel).findByRole('button', { name: 'Skills' });
    await user.click(skills);
    expect(await within(panel).findByText('9 ly range · From ESI · Ayla Vex')).toBeTruthy();
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({
        skills: { jdc: 4, jfc: 5, jf: 2 },
        fatigueNowMinutes: 42,
      }),
    );

    await user.click(within(panel).getByRole('button', { name: /Route options/ }));
    expect(within(panel).getByText('From ESI · Ayla Vex')).toBeTruthy();
    const fatigue = within(panel).getByLabelText('Fatigue now (min)');
    await user.clear(fatigue);
    await user.type(fatigue, '10');
    expect(within(panel).queryByText('From ESI · Ayla Vex')).toBeNull();
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ fatigueNowMinutes: 10 }));
    // The skills still come from ESI: only the fatigue was edited.
    expect(requests.at(-1)).toMatchObject({ skills: { jdc: 4, jfc: 5, jf: 2 } });

    await user.click(within(panel).getByRole('button', { name: 'Read skills and fatigue from ESI again' }));
    await waitFor(() => expect(asked).toBe(2));
    expect(await within(panel).findByText('From ESI · Ayla Vex')).toBeTruthy();
    // The route for 42 minutes was planned before, so it comes from the cache.
    expect((within(panel).getByLabelText('Fatigue now (min)') as HTMLInputElement).value).toBe('42');
  });

  it('offers linking the pilot again for skills when the grant lacks them', async () => {
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    // The folded card warns that the levels are only assumed.
    const skills = await within(panel).findByRole('button', { name: 'Skills' });
    expect(skills.hasAttribute('data-warn')).toBe(true);
    await user.click(skills);
    const link = await within(panel).findByRole('link', { name: 'Allow skills for Ayla Vex' });
    const href = new URL(link.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe(routes.auth.eveLogin.path);
    expect(href.searchParams.get('extras')).toBe('jumps');
    expect(href.searchParams.get('returnTo')).toMatch(/^\/jump/);
    expect(within(panel).getByText(/to fill these from EVE/)).toBeTruthy();
    // Nothing from ESI: the remembered levels stay, and the card says they are assumed.
    expect(within(panel).getByText('10 ly range · Assumed, not read from EVE')).toBeTruthy();
  });

  it('reads the skills when only jump fatigue is missing, and offers fatigue as a quiet extra', async () => {
    server.use(
      http.get(routes.jumps.pilot.path, ({ params }) =>
        HttpResponse.json({
          characterId: Number(params.characterId),
          skills: { jdc: 4, jfc: 5, jf: 2 },
          fatigueMinutes: null,
          fatigueExpiresAt: null,
          missingScopes: ['esi-characters.read_fatigue.v1'],
          problem: null,
          checkedAt: Date.now(),
        } satisfies JumpPilotDto),
      ),
    );
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    // No warning: the levels come from EVE.
    const skills = await within(panel).findByRole('button', { name: 'Skills' });
    await waitFor(() => expect(skills.hasAttribute('data-warn')).toBe(false));
    await user.click(skills);
    expect(within(panel).getByText(/From ESI · Ayla Vex/)).toBeTruthy();
    const fatigue = within(panel).getByRole('link', { name: 'Read jump fatigue too' });
    expect(new URL(fatigue.getAttribute('href')!, 'http://x').searchParams.get('extras')).toMatch(/fatigue/);
    expect(within(panel).queryByRole('link', { name: /Allow skills/ })).toBeNull();
  });

  it('keeps levels picked by hand without warning that they are assumed', async () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ skills: { jdc: 4, jfc: 3, jf: 2 }, skillsByHand: true }),
    );
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    const skills = await within(panel).findByRole('button', { name: 'Skills' });
    expect(skills.hasAttribute('data-warn')).toBe(false);
    await userEvent.setup().click(skills);
    expect(within(panel).getByText(/Set by hand/)).toBeTruthy();
  });

  it('plans with a level set by hand over the one ESI reads, until ESI is asked again', async () => {
    server.use(
      http.get(routes.jumps.pilot.path, ({ params }) =>
        HttpResponse.json({
          characterId: Number(params.characterId),
          skills: { jdc: 4, jfc: 3, jf: 3 },
          fatigueMinutes: null,
          fatigueExpiresAt: null,
          missingScopes: [],
          problem: null,
          checkedAt: Date.now(),
        } satisfies JumpPilotDto),
      ),
    );
    // Calibration V set by hand while it still trains: ESI answers IV, the planner keeps V.
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ skills: { jdc: 5, jfc: 3, jf: 3 }, skillsByHand: true }),
    );
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    const skills = await within(panel).findByRole('button', { name: 'Skills' });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ skills: { jdc: 5, jfc: 3, jf: 3 } }));

    await user.click(skills);
    await user.click(within(panel).getByRole('button', { name: 'Read skills and fatigue from ESI again' }));
    expect(await within(panel).findByText(/From ESI · Ayla Vex/)).toBeTruthy();
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ skills: { jdc: 4, jfc: 3, jf: 3 } }));
  });

  it('plans through stops from the address and prices the fuel', async () => {
    server.use(
      http.get(routes.jumps.fuelPrices.path, () =>
        HttpResponse.json({
          hub: 'jita',
          station: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
          prices: { helium: 700, hydrogen: 616, nitrogen: 650, oxygen: 690 },
          fetchedAt: Date.now(),
        } satisfies JumpFuelPricesDto),
      ),
    );
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&via=Jita&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    await screen.findByRole('region', { name: 'Route' });
    expect(requests.at(-1)).toMatchObject({ via: [30000142] });
    expect(within(panel).getByText('Stop 1')).toBeTruthy();
    // 57,408 helium at 700 ISK.
    // The totals are in the bubble over the map, not in the panel.
    const totals = await screen.findByRole('region', { name: 'Route totals' });
    expect(await within(totals).findByText(/40.2M ISK/)).toBeTruthy();
    expect(within(panel).queryByRole('region', { name: 'Route summary' })).toBeNull();

    // A jump freighter gets a freight quote: the fuel with 20 % markup and 1 % of the collateral.
    // Its own card at the map's right, folded until opened.
    const freight = screen.getByRole('button', { name: /Freight quote/ });
    expect(freight.getAttribute('aria-expanded')).toBe('false');
    await user.click(freight);
    await user.type(screen.getByLabelText('Collateral'), '1b');
    expect(await screen.findByText('58.2M ISK')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!).freight).toMatchObject({ collateral: 1e9 });

    await user.click(within(panel).getByRole('button', { name: 'Remove stop 1' }));
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ via: [] }));
    expect(window.location.search).not.toMatch(/via=/);
  });

  it('reorders the trip like a maps app: a stop dragged or moved with the keys changes the route', async () => {
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&via=Jita&ship=Ark');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    await screen.findByRole('region', { name: 'Route' });
    expect(requests.at(-1)).toMatchObject({ origin: 30002647, via: [30000142], destination: 30005035 });
    // The stop moves up past the start with the arrow key on its grip: Jita becomes the start.
    within(panel)
      .getByRole('button', { name: /Move stop 1/ })
      .focus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({ origin: 30000142, via: [30002647], destination: 30005035 }),
    );
    expect(window.location.search).toMatch(/from=Jita&to=Ami&via=Ignoitton/);
    // The grip of the moved point keeps the focus, so it can move on.
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/Move start/);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({ origin: 30002647, via: [30005035], destination: 30000142 }),
    );
  });

  it('shares the route on screen as a link and copies it', async () => {
    const shared: unknown[] = [];
    server.use(
      http.post(routes.jumps.share.path, async ({ request }) => {
        shared.push(await request.json());
        return HttpResponse.json({ token: 'AbCdEfGhIjKlMnOpQrStUv' });
      }),
    );
    window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    await screen.findByRole('region', { name: 'Route' });
    // A jump freighter's route goes to pilots, or to a client as a freight quote.
    await user.click(within(panel).getByRole('button', { name: 'Share' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Route for pilots' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/j/AbCdEfGhIjKlMnOpQrStUv`),
    );
    expect(shared[0]).toMatchObject({
      plan: { origin: 30002647, destination: 30005035 },
      fuelHub: 'jita',
      route: 'jump:30005196,jump:30005035',
      freight: null,
    });
    expect(await screen.findByText('Share link copied')).toBeTruthy();

    // The client's quote: the price set by hand over the planner's.
    await user.click(within(panel).getByRole('button', { name: 'Share' }));
    await user.click(await screen.findByRole('menuitem', { name: /Freight quote for a client/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Freight quote for a client' });
    const price = within(dialog).getByLabelText('Price (ISK)');
    await user.clear(price);
    await user.type(price, '150m');
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(shared).toHaveLength(2));
    expect(shared[1]).toMatchObject({ freight: { price: 150_000_000 } });
    expect(await screen.findByText('Freight quote link copied')).toBeTruthy();
  });

  it('starts from the address and clears with Escape', async () => {
    window.history.replaceState(null, '', '/jump?from=Jita&to=Ami&ship=Avatar');
    const user = userEvent.setup();
    renderPage();
    const panel = await screen.findByRole('complementary', { name: 'Planner' });
    await user.click(within(panel).getByRole('button', { name: 'Skills' }));
    expect(within(panel).getByText(/^6 ly range/)).toBeTruthy();
    await screen.findByRole('region', { name: 'Route' });
    expect(requests[0]).toMatchObject({ shipTypeId: 11567, origin: 30000142, destination: 30005035 });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(within(panel).queryByRole('region', { name: 'Route' })).toBeNull());
  });

  describe('waypoints', () => {
    const sent: Array<{ characterId: number } & WaypointRequest> = [];
    const pilot = (id: number, name: string): CharacterDto => ({
      ...meFixture().characters[0]!,
      id,
      name,
      canSetWaypoints: true,
    });
    const withPilots = (...characters: CharacterDto[]) =>
      server.use(
        http.get(routes.accounts.me.path, () => HttpResponse.json({ ...meFixture(), characters })),
        http.post(routes.routing.waypoint.path, async ({ request, params }) => {
          sent.push({
            characterId: Number(params.characterId),
            ...((await request.json()) as WaypointRequest),
          });
          return new HttpResponse(null, { status: 204 });
        }),
      );
    beforeEach(() => {
      sent.length = 0;
    });

    it('sends the jump route to my one character in one click', async () => {
      withPilots(pilot(AYLA, 'Ayla Vex'));
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
      const user = userEvent.setup();
      renderPage();
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      await screen.findByRole('region', { name: 'Route' });
      await user.click(await within(panel).findByRole('button', { name: 'Send waypoints to Ayla Vex' }));
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(sent).toEqual([
        { characterId: AYLA, solarSystemId: 30005196, mode: 'destination' },
        { characterId: AYLA, solarSystemId: 30005035, mode: 'waypoint' },
      ]);
      expect(await screen.findByText('Waypoints set for Ayla Vex')).toBeTruthy();
    });

    it('offers all my characters first, then each by name, and sends at once', async () => {
      const ALT = 3_900_000_002;
      withPilots(pilot(AYLA, 'Ayla Vex'), pilot(ALT, 'Bram Holt'));
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
      const user = userEvent.setup();
      renderPage();
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      await screen.findByRole('region', { name: 'Route' });
      await user.click(await within(panel).findByRole('button', { name: 'Set in-game waypoints' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'All characters',
        'Ayla Vex',
        'Bram Holt',
      ]);
      await user.click(screen.getByRole('menuitem', { name: 'All characters' }));
      await waitFor(() => expect(sent).toHaveLength(4));
      // Each character's route in order; the characters side by side.
      for (const characterId of [AYLA, ALT])
        expect(sent.filter((w) => w.characterId === characterId)).toEqual([
          { characterId, solarSystemId: 30005196, mode: 'destination' },
          { characterId, solarSystemId: 30005035, mode: 'waypoint' },
        ]);
      expect(await screen.findByText('Waypoints set for 2 characters')).toBeTruthy();

      await user.click(within(panel).getByRole('button', { name: 'Set in-game waypoints' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Bram Holt' }));
      await waitFor(() => expect(sent).toHaveLength(6));
      expect(sent.slice(4).every((w) => w.characterId === ALT)).toBe(true);
    });
  });

  describe('gates and wormholes', () => {
    const THERA = 31000005;
    const J_SYSTEM = 31002531;
    const step = (
      solarSystemId: number,
      name: string,
      via: RouteStepDto['via'],
      extra: Partial<RouteStepDto> = {},
    ): RouteStepDto => ({
      solarSystemId,
      name,
      security: 0.4,
      whClass: null,
      classLabel: null,
      via,
      connectionId: null,
      regionName: 'Domain',
      ...extra,
    });
    /** Ignoitton > Jita by gate > Thera > Ahbazon (EVE-Scout) > a C3 of the chain > Ami. */
    const throughThera: RouteDto = {
      from: 30002647,
      to: 30005035,
      mode: 'shortest',
      jumps: 5,
      steps: [
        step(30002647, 'Ignoitton', 'start'),
        step(30000142, 'Jita', 'gate'),
        step(THERA, 'Thera', 'wormhole', {
          edge: 'eve-scout',
          whClass: 12,
          classLabel: 'Thera',
          security: -0.99,
          regionName: 'G-R00031',
        }),
        step(30005196, 'Ahbazon', 'wormhole', { edge: 'eve-scout' }),
        step(J_SYSTEM, 'J123456', 'wormhole', {
          connectionId: 'c1',
          whClass: 3,
          classLabel: 'C3',
          security: -0.99,
          regionName: 'C-R00012',
        }),
        step(30005035, 'Ami', 'wormhole', { connectionId: 'c2' }),
      ],
      securityStatus: null,
    };
    const asked: URL[] = [];
    const sent: WaypointRequest[] = [];
    beforeEach(() => {
      asked.length = 0;
      sent.length = 0;
      server.use(
        http.get(routes.routing.preferences.path, () => HttpResponse.json(DEFAULT_ROUTE_PREFERENCES)),
        http.get(routes.routing.route.path, ({ request, params }) => {
          expect(params.mapId).toBe('m-home');
          const url = new URL(request.url);
          asked.push(url);
          return HttpResponse.json(throughThera);
        }),
        http.get(routes.accounts.me.path, () =>
          HttpResponse.json({
            ...meFixture(),
            characters: [{ ...meFixture().characters[0]!, canSetWaypoints: true }],
          }),
        ),
        http.post(routes.routing.waypoint.path, async ({ request }) => {
          sent.push((await request.json()) as WaypointRequest);
          return new HttpResponse(null, { status: 204 });
        }),
      );
    });

    it("plans any ship over gates, the map's holes and Thera, without the jump planner", async () => {
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&mode=travel');
      renderPage(CHAIN);
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      await screen.findByRole('region', { name: 'Route' });
      expect(asked).toHaveLength(1);
      expect(asked[0]!.searchParams.get('from')).toBe('30002647');
      expect(asked[0]!.searchParams.get('to')).toBe('30005035');
      // The jump planner is not asked, and its ship, range, fuel and skills are not offered.
      expect(requests).toHaveLength(0);
      expect(within(panel).getByRole('radio', { name: 'Route' }).getAttribute('aria-checked')).toBe('true');
      expect(within(panel).queryByText('Hull')).toBeNull();
      expect(within(panel).queryByRole('button', { name: 'Skills' })).toBeNull();
      expect(within(panel).queryByRole('button', { name: 'Route options' })).toBeNull();
      expect(within(panel).queryByRole('button', { name: 'Share' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Freight quote/ })).toBeNull();

      // Every system the trip passes, tagged by how it is reached; wormhole space by its class.
      const legs = [...panel.querySelectorAll('[data-kind]')];
      expect(legs.map((l) => l.getAttribute('data-kind'))).toEqual(['gate', 'thera', 'thera', 'wormhole']);
      expect(legs.map((l) => l.querySelector('em')?.textContent)).toEqual([
        'gate',
        'Thera',
        'Thera',
        'wormhole',
      ]);
      expect(legs[1]!.textContent).toMatch(/^TheraThera/);
      expect(legs[3]!.textContent).toMatch(/^C3J123456/);
      expect(
        panel.querySelector('[data-picker="destination"]')!.closest('[data-point]')!.textContent,
      ).toMatch(/Ami/);
      const totals = screen.getByRole('region', { name: 'Route totals' });
      expect(totals.textContent).toBe('5 jumpsGates1Wormholes2Thera2');
      await waitFor(() => expect(window.location.search).toBe('?from=Ignoitton&to=Ami&mode=travel'));
    });

    it('sends where each hole is taken and the destination as waypoints, never wormhole space', async () => {
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&mode=travel');
      const user = userEvent.setup();
      renderPage(CHAIN);
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      await screen.findByRole('region', { name: 'Route' });
      await user.click(await within(panel).findByRole('button', { name: 'Send waypoints to Ayla Vex' }));
      await waitFor(() => expect(sent).toHaveLength(3));
      // Jita (into Thera), Ahbazon (into the chain), Ami; Thera and the C3 are flown by hand.
      expect(sent).toEqual([
        { solarSystemId: 30000142, mode: 'destination' },
        { solarSystemId: 30005196, mode: 'waypoint' },
        { solarSystemId: 30005035, mode: 'waypoint' },
      ]);
      expect(await screen.findByText(/the autopilot does not/)).toBeTruthy();
    });

    it('routes each stretch between stops and says which one has no route', async () => {
      server.use(
        http.get(routes.routing.route.path, ({ request }) => {
          const url = new URL(request.url);
          asked.push(url);
          const from = Number(url.searchParams.get('from'));
          const to = Number(url.searchParams.get('to'));
          return HttpResponse.json(
            from === 30002647
              ? {
                  ...throughThera,
                  to,
                  steps: [step(30002647, 'Ignoitton', 'start'), step(30000142, 'Jita', 'gate')],
                  jumps: 1,
                }
              : { ...throughThera, from, to, steps: [], jumps: null },
          );
        }),
      );
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&via=Jita&mode=travel');
      renderPage(CHAIN);
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      expect(await within(panel).findByText('No route')).toBeTruthy();
      expect(asked.map((u) => [u.searchParams.get('from'), u.searchParams.get('to')])).toEqual([
        ['30002647', '30000142'],
        ['30000142', '30005035'],
      ]);
      // Jita arrives as the stop; nothing is offered for a trip without its whole way.
      expect(panel.querySelector('[data-picker="stop"]')!.textContent).toMatch(/Jita/);
      expect(within(panel).queryByRole('button', { name: /Send waypoints/ })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Route totals' })).toBeNull();
      expect(requests).toHaveLength(0);
    });

    it('needs a map to route through, and remembers the mode', async () => {
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&mode=travel');
      renderPage(null);
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      expect(await within(panel).findByText('No map to route through')).toBeTruthy();
      expect(asked).toHaveLength(0);
      expect(requests).toHaveLength(0);
      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({
          version: 4,
          mode: 'travel',
        }),
      );
    });

    it('switches between a route and cyno jumps at the top of the planner', async () => {
      window.history.replaceState(null, '', '/jump?from=Ignoitton&to=Ami&ship=Ark');
      const user = userEvent.setup();
      renderPage(CHAIN);
      const panel = await screen.findByRole('complementary', { name: 'Planner' });
      await screen.findByRole('region', { name: 'Route' });
      expect(requests).toHaveLength(1);
      expect(within(panel).getByRole('radio', { name: 'Cyno jumps' }).getAttribute('aria-checked')).toBe(
        'true',
      );
      expect(within(panel).getByText('Hull')).toBeTruthy();
      await user.click(within(panel).getByRole('radio', { name: 'Route' }));
      await waitFor(() => expect(asked).toHaveLength(1));
      await waitFor(() => expect(window.location.search).toBe('?from=Ignoitton&to=Ami&mode=travel'));
      expect(requests).toHaveLength(1);
      expect(within(panel).queryByText('Hull')).toBeNull();

      await user.click(within(panel).getByRole('radio', { name: 'Cyno jumps' }));
      await waitFor(() => expect(window.location.search).toBe('?from=Ignoitton&to=Ami&ship=Ark'));
      expect(within(panel).getByRole('button', { name: 'Skills' })).toBeTruthy();
    });
  });
});
