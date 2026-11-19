// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import {
  routes,
  type ChainPresenceListDto,
  type ConnectionDto,
  type MapSystemDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { chainPresenceText, useChainPresence } from '../../lib/chain-presence';
import { connectionFixture, MAP_ID, meFixture, systemFixture } from '../../test/fixtures';
import { renderWithProviders, setupMockServer } from '../../test/setup';
import { TooltipProvider } from '../../ui';
import { AddSystemSearch } from '../AddSystemSearch';
import { SystemInfoWidget } from './SystemDetails';

const HOME = 31000001;
const HOLE = 31000002;
const OLD = 31000003;
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const info = (id: number): UniverseSystemDto => ({
  id,
  name: `J${id}`,
  regionName: 'A-R00001',
  constellationName: 'A-C00001',
  security: -0.99,
  whClass: 3,
  statics: [],
  effect: null,
});

const record: ChainPresenceListDto = {
  recordedSince: now - 30 * DAY,
  systems: [
    { solarSystemId: HOME, joinedAt: now - 30 * DAY, leftAt: null },
    { solarSystemId: HOLE, joinedAt: now - 2 * 60 * 60 * 1000, leftAt: null },
    { solarSystemId: OLD, joinedAt: now - 6 * DAY, leftAt: now - 3 * DAY },
  ],
};

setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
  http.get(routes.chainPresence.list.path, () => HttpResponse.json(record)),
  http.get(routes.intel.system.path, () => new Promise<never>(() => {})),
  http.get(routes.intel.standings.path, () => new Promise<never>(() => {})),
  http.get(routes.universe.searchSystems.path, () => HttpResponse.json([info(OLD), info(31000009)])),
);

/** System info for one system of a map whose home has a hole out to HOLE; OLD sits apart. */
function Info({ solarSystemId }: { solarSystemId: number }) {
  const systems = new Map<number, MapSystemDto>(
    [
      systemFixture(HOME, { status: 'home' }),
      systemFixture(HOLE),
      systemFixture(OLD),
      systemFixture(31000004),
    ].map((s) => [s.solarSystemId, s]),
  );
  const connections = new Map<string, ConnectionDto>([['c1', connectionFixture('c1', HOME, HOLE)]]);
  const chain = useChainPresence(MAP_ID, systems, connections);
  return (
    <SystemInfoWidget
      mapId={MAP_ID}
      system={systems.get(solarSystemId)!}
      info={info(solarSystemId)}
      labels={[]}
      systemLabels={[]}
      canEdit={false}
      chain={chain(solarSystemId)}
    />
  );
}

const show = (solarSystemId: number) =>
  renderWithProviders(
    <TooltipProvider>
      <Info solarSystemId={solarSystemId} />
    </TooltipProvider>,
  );

describe('when a system was last in the chain from home', () => {
  it('says so in one quiet line of System info, with the moment itself on hover', async () => {
    show(OLD);
    await waitFor(() =>
      expect(screen.getByTestId('chain-presence').textContent).toBe('Last in our chain 3 d ago'),
    );
    expect(screen.getByTestId('chain-presence').title).toBe(
      chainPresenceText({ kind: 'past', at: now - 3 * DAY }).title,
    );
  });

  it('says a system the chain reaches now is in it, and nothing on the home itself', async () => {
    const { unmount } = show(HOLE);
    expect(screen.getByTestId('chain-presence').textContent).toBe('In the chain now');
    await waitFor(() =>
      expect(screen.getByTestId('chain-presence').title).toMatch(/^In the chain from home since /),
    );
    unmount();
    show(HOME);
    expect(screen.queryByTestId('chain-presence')).toBeNull();
  });

  it('says never for a system the record does not hold', async () => {
    show(31000004);
    await waitFor(() => expect(screen.getByTestId('chain-presence').title).toMatch(/^Recorded since /));
    expect(screen.getByTestId('chain-presence').textContent).toBe('Never in our chain');
  });

  it('tells in the search which systems not on the map the chain held before', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AddSystemSearch
        onMap={new Set()}
        onPick={() => {}}
        chainHint={(id) => (id === OLD ? 'In chain 4 d ago' : null)}
      />,
    );
    await user.type(screen.getByRole('combobox'), 'J31');
    const old = await screen.findByRole('option', { name: /J31000003/ });
    expect(old.textContent).toContain('In chain 4 d ago');
    expect(screen.getByRole('option', { name: /J31000009/ }).textContent).not.toContain('In chain');
  });
});
