// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { http, HttpResponse } from 'msw/http';
import {
  buildPath,
  routes,
  type CharacterPresenceDto,
  type MapDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import { MapView } from '../../screens/MapView';
import { MAP_ID, meFixture, signatureFixture, systemFixture } from '../../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../../test/setup';
import { ToastProvider, TooltipProvider } from '../../ui';
import { emptyMapState, type MapState } from '../mapState';
import { useMapStore } from '../useMapStore';
import { COLLAPSED_KEY, WIDTH_KEY } from './storage';
import { SystemSidebar } from './SystemSidebar';

installFlowMocks();

const WH = 31000001;
const JITA = 30000142;
const universe: Record<number, UniverseSystemDto> = {
  [WH]: {
    id: WH,
    name: 'J100001',
    regionName: 'A-R00001',
    constellationName: 'A-C00311',
    security: -0.99,
    whClass: 3,
    statics: ['D845'],
    effect: 'pulsar',
  },
  [JITA]: {
    id: JITA,
    name: 'Jita',
    regionName: 'The Forge',
    constellationName: 'Kimotoro',
    security: 0.946,
    whClass: 7,
    statics: [],
    effect: null,
  },
};
const me = meFixture();
const pilot = (id: number, name: string, solarSystemId: number): CharacterPresenceDto => ({
  characterId: id,
  accountId: 'acc',
  name,
  solarSystemId,
  shipTypeId: 11567,
  shipName: `${name}'s Loki`,
  online: true,
  updatedAt: 1,
});
const pilots = [
  pilot(me.characters[0]!.id, me.characters[0]!.name, WH),
  pilot(95_000_001, 'Hostile Guy', WH),
];

const server = setupMockServer(
  http.get(routes.accounts.me.path, () => HttpResponse.json(me)),
  http.get(routes.universe.getSystem.path, ({ params }) =>
    HttpResponse.json(universe[Number(params.solarSystemId)]),
  ),
  http.get(routes.connections.intel.path, () => HttpResponse.json([])),
  http.get(routes.maps.getPreferences.path, () =>
    HttpResponse.json({ viewport: null, bookmarkTemplate: null, updatedAt: 0 }),
  ),
  http.get(routes.tracking.characters.path, () => HttpResponse.json(pilots)),
  http.get(routes.maps.get.path, () => HttpResponse.json(mapDto)),
);

const mapDto: MapDto = {
  id: MAP_ID,
  slug: 'home',
  name: 'Home',
  ownerAccountId: 'acc',
  settings: { scopes: ['wormhole'] },
  labels: [{ id: 'l1', name: 'Staging', color: '#3b82f6', description: '' }],
  createdAt: 1,
  updatedAt: 1,
};

const wrap = (ui: ReactElement) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
  );

/** A matchMedia that answers the phone query as told. */
function screenWidth(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  screenWidth(false);
});
afterEach(() => vi.restoreAllMocks());

describe('the map view', () => {
  const snapshot: StreamSnapshotDto = {
    stream: `map:${MAP_ID}`,
    seq: 1,
    data: {
      systems: [
        systemFixture(WH, { position: { x: 0, y: 0 } }),
        systemFixture(JITA, { position: { x: 400, y: 0 } }),
      ],
      connections: [],
      signatures: [signatureFixture('s1', WH, 'ABC-123', { group: 'wormhole', type: 'D845' })],
    },
  };

  const view = () =>
    wrap(
      <ReactFlowProvider>
        <div style={{ width: 1200, height: 800 }}>
          <MapView map={mapDto} role="member" snapshot={snapshot} />
        </div>
      </ReactFlowProvider>,
    );

  const node = async (id: number) => {
    await waitFor(() => expect(document.querySelector(`.react-flow__node[data-id="${id}"]`)).toBeTruthy());
    return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  };

  it('has no sidebar and no tabs until a system is selected; closing clears the selection', async () => {
    const user = userEvent.setup();
    view();
    await node(WH);
    expect(screen.queryByRole('complementary', { name: 'System' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /system panel/ })).toBeNull();

    // A plain click: d3-drag reads `event.view` on mousedown, which jsdom leaves empty.
    fireEvent.click(await node(WH));
    const sidebar = await screen.findByRole('complementary', { name: 'System' });
    // Every section at once, no tabs.
    for (const name of ['System', 'Signatures', 'Local'])
      expect(within(sidebar).getByRole('region', { name })).toBeTruthy();
    expect(within(sidebar).getByRole('heading', { name: 'J100001' })).toBeTruthy();
    expect(within(sidebar).getByText('ABC-123')).toBeTruthy();
    expect(await within(sidebar).findByText('Hostile Guy')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();

    // The top bar's toggle hides it and keeps the selection.
    await user.click(screen.getByRole('button', { name: 'Hide system panel' }));
    expect(screen.queryByRole('complementary', { name: 'System' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show system panel' }));
    expect(screen.getByRole('complementary', { name: 'System' })).toBeTruthy();

    await user.click(
      within(screen.getByRole('complementary', { name: 'System' })).getByRole('button', { name: 'Close' }),
    );
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'System' })).toBeNull());
    expect((await node(WH)).classList.contains('selected')).toBe(false);
  });
});

function Sidebar({
  state,
  solarSystemId = WH,
  onClose = () => {},
}: {
  state: Partial<MapState>;
  solarSystemId?: number;
  onClose?: () => void;
}) {
  const store = useMapStore(MAP_ID);
  const full = { ...emptyMapState(), has: { signatures: true, characters: true }, ...state };
  return (
    <div style={{ height: 800 }}>
      <SystemSidebar
        mapId={MAP_ID}
        system={systemFixture(solarSystemId)}
        info={universe[solarSystemId]}
        universe={new Map(Object.values(universe).map((u) => [u.id, u]))}
        labels={mapDto.labels}
        state={full}
        can={mapPermissions('member')}
        store={store}
        myCharacters={me.characters}
        plugins={[]}
        open
        focusToken={0}
        onClose={onClose}
        onSelectSystem={() => {}}
        onCover={() => {}}
      />
    </div>
  );
}

describe('SystemSidebar', () => {
  it('carries the system header: pill, place, class, effect, statics and links out', () => {
    wrap(<Sidebar state={{}} />);
    const header = screen.getByRole('complementary', { name: 'System' });
    expect(header.textContent).toContain('C3');
    expect(header.textContent).toContain('A-R00001 › A-C00311');
    expect(header.textContent).toContain('Class 3 wormhole');
    expect(screen.getByLabelText(/^Pulsar: /)).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Statics' })).getByText('D845').nextSibling?.textContent,
    ).toBe('HS');
    expect(screen.getByRole('link', { name: 'zKillboard' }).getAttribute('href')).toBe(
      `https://zkillboard.com/system/${WH}/`,
    );
    expect(screen.getByRole('link', { name: 'Anoikis' }).getAttribute('href')).toBe(
      'https://anoik.is/systems/J100001',
    );
  });

  it('shows known space with its security and no Anoikis link', () => {
    wrap(<Sidebar state={{}} solarSystemId={JITA} />);
    expect(screen.getByRole('complementary', { name: 'System' }).textContent).toContain('High-sec 0.95');
    expect(screen.getByRole('link', { name: 'Dotlan' }).getAttribute('href')).toBe(
      'https://evemaps.dotlan.net/system/Jita',
    );
    expect(screen.queryByRole('link', { name: 'Anoikis' })).toBeNull();
  });

  it('folds sections and remembers them', async () => {
    const user = userEvent.setup();
    const first = wrap(<Sidebar state={{}} />);
    const toggle = screen.getByRole('button', { name: /Signatures/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Paste probe scanner results' })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY)!)).toEqual({ signatures: true });
    first.unmount();

    wrap(<Sidebar state={{}} />);
    expect(screen.getByRole('button', { name: /Signatures/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /System/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('pastes probe scanner text with Ctrl+V anywhere outside a text field', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(
        buildPath(routes.signatures.paste.path, { mapId: MAP_ID, solarSystemId: WH }),
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ added: 3, updated: 1, removed: 0, skipped: [] });
        },
      ),
    );
    wrap(<Sidebar state={{}} />);
    const paste = (target: EventTarget, text: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
      act(() => void target.dispatchEvent(event));
    };
    // Into a field it is the field's text; random text is not a scan.
    paste(screen.getByRole('textbox', { name: 'Custom name' }), 'ABC-123\tCosmic Signature');
    paste(document.body, 'hello there');
    expect(bodies).toEqual([]);

    paste(document.body, 'ABC-123\tCosmic Signature\tWormhole\t\t0.0%\t2.1 AU');
    expect(await screen.findByText('3 new / 1 updated')).toBeTruthy();
    expect(bodies).toEqual([{ text: 'ABC-123\tCosmic Signature\tWormhole\t\t0.0%\t2.1 AU', mode: 'merge' }]);
  });

  it('lists who is in the system, mine first and highlighted, with their ships', () => {
    wrap(<Sidebar state={{ characters: new Map(pilots.map((p) => [p.characterId, p])) }} />);
    const local = screen.getByRole('region', { name: 'Local' });
    const rows = within(local).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      `${me.characters[0]!.name} (you)${me.characters[0]!.name}'s Loki`,
      "Hostile GuyHostile Guy's Loki",
    ]);
    expect(rows[0]!.dataset.mine).toBe('true');
    expect(rows[1]!.dataset.mine).toBeUndefined();
    expect(within(local.querySelector('header')!).getByText('2')).toBeTruthy();
  });

  it('edits tag, notes and labels in place', async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch(
        buildPath(routes.systems.update.path, { mapId: MAP_ID, solarSystemId: WH }),
        async ({ request }) => {
          patches.push(await request.json());
          return HttpResponse.json(systemFixture(WH));
        },
      ),
    );
    const user = userEvent.setup();
    wrap(<Sidebar state={{}} />);
    await user.type(screen.getByRole('textbox', { name: 'Tag' }), 'A1{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Loki fleet in C3');
    await user.click(screen.getByRole('button', { name: 'Staging' }));
    await waitFor(() =>
      expect(patches).toEqual([{ tag: 'A1' }, { description: 'Loki fleet in C3' }, { labelIds: ['l1'] }]),
    );
  });

  it('keeps its width within bounds and remembers it', () => {
    wrap(<Sidebar state={{}} />);
    const handle = screen.getByRole('separator', { name: 'Resize the panel' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(handle.getAttribute('aria-valuenow')).toBe('444');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('444');
    for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(handle.getAttribute('aria-valuenow')).toBe('320');
  });

  it('is a bottom sheet on phones: peek, half and full from the handle', async () => {
    screenWidth(true);
    const user = userEvent.setup();
    wrap(<Sidebar state={{}} />);
    const sheet = screen.getByRole('complementary', { name: 'System' });
    expect(sheet.dataset.phone).toBe('true');
    expect(sheet.dataset.stop).toBe('peek');
    expect(screen.queryByRole('separator')).toBeNull();
    // The same sections as on wide screens.
    for (const name of ['System', 'Signatures', 'Local'])
      expect(within(sheet).getByRole('region', { name })).toBeTruthy();

    const handle = screen.getByRole('button', { name: 'Expand the panel' });
    await user.click(handle);
    expect(sheet.dataset.stop).toBe('half');
    await user.click(screen.getByRole('button', { name: 'Expand the panel fully' }));
    expect(sheet.dataset.stop).toBe('full');
    await user.click(screen.getByRole('button', { name: 'Collapse the panel' }));
    expect(sheet.dataset.stop).toBe('peek');
  });
});
