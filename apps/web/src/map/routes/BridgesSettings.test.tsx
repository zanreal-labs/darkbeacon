// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import {
  buildPath,
  routes,
  type BridgeDto,
  type EveEntityDto,
  type ImportBridgesResultDto,
  type MapDto,
  type MeDto,
} from '@darkbeacon/shared';
import { MAP_ID, meFixture } from '../../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { BridgesSettings } from './RoutingSettings';

// Radix measures controls with ResizeObserver, which jsdom lacks.
installFlowMocks();

let me: MeDto = meFixture();
let answer: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
const reads: unknown[] = [];
let onMap: BridgeDto[] = [];

const end = (solarSystemId: number, name: string) => ({
  solarSystemId,
  name,
  security: -0.4,
  regionName: 'Delve',
});
const bridge = (id: string, a: string, b: string, owner: Partial<BridgeDto> = {}): BridgeDto => ({
  id,
  a: end(1, a),
  b: end(2, b),
  dangerous: false,
  source: 'paste',
  structureName: null,
  structureId: null,
  ownerCorporationId: null,
  ownerAllianceId: null,
  createdAt: 0,
  ...owner,
});

setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(me)),
  http.get(buildPath(routes.bridges.list.path, { mapId: MAP_ID }), () => HttpResponse.json(onMap)),
  http.get(routes.eve.entities.path, () =>
    HttpResponse.json([
      { id: 99000001, name: 'Our Alliance', category: 'alliance', ticker: 'OURS' },
    ] satisfies EveEntityDto[]),
  ),
  http.post(buildPath(routes.bridges.readFromEsi.path, { mapId: MAP_ID }), async ({ request }) => {
    reads.push(await request.json());
    return HttpResponse.json(answer.body, { status: answer.status });
  }),
);

const MAP = { id: MAP_ID, slug: 'home', name: 'Home' } as MapDto;
const withExtras = (extras: NonNullable<MeDto['characters'][number]['extras']>): MeDto => {
  const base = meFixture();
  return { ...base, characters: base.characters.map((c) => ({ ...c, extras })) };
};

const wrap = () =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <BridgesSettings map={MAP} />
      </ToastProvider>
    </TooltipProvider>,
  );

describe('finding jump bridges in the map settings', () => {
  it('offers to link the character again with the structures access it lacks', async () => {
    me = withExtras(['wallet']);
    wrap();
    expect(await screen.findByText('Link again to find jump bridges')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Link Ayla Vex again/ });
    const href = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(href.pathname).toBe(routes.auth.eveLogin.path);
    expect(href.searchParams.get('extras')).toBe('wallet,structures');
  });

  it('finds bridges with the chosen character and says when EVE showed none', async () => {
    me = withExtras(['structures']);
    answer = {
      status: 200,
      body: {
        added: 0,
        known: 0,
        unknownSystems: [],
        unreadable: [],
        bridges: [],
        found: 0,
      } satisfies ImportBridgesResultDto,
    };
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Find jump bridges from Ayla Vex' }));
    expect(await screen.findByText('No jump bridges found')).toBeTruthy();
    expect(reads.at(-1)).toEqual({ characterId: me.characters[0]!.id });
    expect(screen.queryByText('Link again to find jump bridges')).toBeNull();
  });

  it('names the owner of each bridge, and says when a pasted one has none', async () => {
    me = withExtras(['structures']);
    onMap = [
      bridge('b1', '1DQ1-A', '4O-239', {
        source: 'esi',
        ownerCorporationId: 98000001,
        ownerAllianceId: 99000001,
      }),
      bridge('b2', 'T5ZI-S', 'PR-8CA'),
    ];
    wrap();
    expect(await screen.findByText(/Our Alliance \[OURS\]/)).toBeTruthy();
    expect(screen.getByText(/pasted, owner unknown/)).toBeTruthy();
    onMap = [];
  });

  it('shows why EVE refused', async () => {
    me = withExtras([]);
    answer = {
      status: 403,
      body: {
        error: {
          code: 'forbidden',
          message: 'Link the character again to let Darkbeacon find jump bridges',
        },
      },
    };
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Find jump bridges from Ayla Vex' }));
    expect(
      await screen.findByText('Link the character again to let Darkbeacon find jump bridges'),
    ).toBeTruthy();
  });
});
