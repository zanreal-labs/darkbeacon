// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import {
  buildPath,
  routes,
  type ConnectionDto,
  type MapDto,
  type SignatureDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { mapPermissions } from '../../lib/roles';
import {
  connectionFixture,
  eventMessage,
  MAP_ID,
  meFixture,
  signatureFixture,
  systemFixture,
} from '../../test/fixtures';
import {
  FakeSocket,
  fakeRealtime,
  installFlowMocks,
  renderWithProviders,
  setupMockServer,
} from '../../test/setup';
import { signatureUndoables, subscribeSignatureUndo } from './undo';
import { ToastProvider, TooltipProvider } from '../../ui';
import { CommentsSection } from '../sidebar/CommentsSection';
import { SignaturesSection, useSignaturePaste } from '../sidebar/SignaturesSection';
import { countdown } from '../sidebar/StructuresSection';
import { useMapStore } from '../useMapStore';
import { ageLabel, destinationChoices, freshness, leadsToChoices, signatureLeadsTo } from './facts';
import { DEFAULT_SIGNATURE_PREFS, setSignaturePrefs, SIGNATURE_PREFS_KEY } from './prefs';
import { onLinkChanges } from './onLink';
import { linkCandidates, SignatureLayer } from './SignatureLayer';
import { SignatureEditor } from './SignatureEditor';

const SYSTEM = 31000001;
const C5 = 31000002;
const HS = 30000142;
const server = setupMockServer();
const universe = new Map<number, UniverseSystemDto>([
  [SYSTEM, { id: SYSTEM, name: 'J100001', whClass: 3, statics: ['D845'] } as UniverseSystemDto],
  [C5, { id: C5, name: 'J100002', whClass: 5 } as UniverseSystemDto],
  [HS, { id: HS, name: 'Jita', whClass: 7 } as UniverseSystemDto],
]);

const render = (ui: ReactElement) =>
  renderWithProviders(
    <TooltipProvider>
      <ToastProvider>{ui}</ToastProvider>
    </TooltipProvider>,
  );

// Radix selects measure and scroll their items, which jsdom cannot.
installFlowMocks();
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

beforeEach(() => {
  window.localStorage.removeItem(SIGNATURE_PREFS_KEY);
  setSignaturePrefs(DEFAULT_SIGNATURE_PREFS);
});

describe('signature facts', () => {
  it('knows where a hole leads and which connected systems fit', () => {
    expect(signatureLeadsTo({ type: 'D845', destination: null })).toEqual(['hs']);
    expect(signatureLeadsTo({ type: 'K162', destination: 'c4_c5' })).toEqual(['c4', 'c5']);
    expect(signatureLeadsTo({ type: 'K162', destination: null })).toBeNull();
    expect(destinationChoices('C729')).toEqual(['hs', 'ls', 'ns', 'pochven']);
    const toC5 = connectionFixture('c1', SYSTEM, C5);
    const toHs = connectionFixture('c2', HS, SYSTEM);
    const sig = signatureFixture('s1', SYSTEM, 'ABC-123', { group: 'wormhole', type: 'D845' });
    expect(leadsToChoices(sig, [toC5, toHs], universe).map((c) => [c.systemId, c.fits])).toEqual([
      [HS, true],
      [C5, false],
    ]);
    expect(linkCandidates(SYSTEM, toHs, [sig], universe).map((s) => s.eveId)).toEqual(['ABC-123']);
    expect(linkCandidates(SYSTEM, toC5, [sig], universe)).toEqual([]);
  });

  it('counts ages and highlights new rows', () => {
    expect(ageLabel(0, 45_000)).toBe('45s');
    expect(ageLabel(0, 3 * 3_600_000 + 5 * 60_000)).toBe('3h 05m');
    expect(freshness(0, 30_000)).toBe('fresh');
    expect(freshness(0, 300_000)).toBe('recent');
    expect(freshness(0, 900_000)).toBeUndefined();
    expect(countdown(Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 1))).toBe('24:00:00');
    expect(countdown(0, 5)).toBe('00:00:00');
  });
});

describe('SignatureEditor', () => {
  it('saves the wormhole fields and the link in one change', async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    const toHs = connectionFixture('c2', SYSTEM, HS);
    render(
      <SignatureEditor
        signature={signatureFixture('s1', SYSTEM, 'ABC-123', { group: 'wormhole', type: 'D845' })}
        system={universe.get(SYSTEM)}
        connections={new Map<string, ConnectionDto>([[toHs.id, toHs]])}
        universe={universe}
        systemName={(id) => universe.get(id)?.name ?? '?'}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Leads to system' }));
    await user.click(await screen.findByRole('option', { name: /Jita/ }));
    await user.type(screen.getByRole('textbox', { name: 'Temporary name' }), 'Exit');
    await user.click(screen.getByRole('checkbox', { name: 'Hole is inside a bubble' }));
    await user.click(screen.getByRole('radio', { name: 'EOL' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        group: 'wormhole',
        description: '',
        type: 'D845',
        destination: null,
        tempName: 'Exit',
        bubbled: true,
        connectionId: 'c2',
        timeStatus: 'eol',
      }),
    );
  });
});

function Section({ signatures }: { signatures: SignatureDto[] }) {
  const store = useMapStore(MAP_ID);
  const paste = useSignaturePaste(MAP_ID, SYSTEM, store);
  return (
    <SignaturesSection
      mapId={MAP_ID}
      solarSystemId={SYSTEM}
      signatures={signatures}
      streamed
      connections={new Map()}
      universe={universe}
      can={mapPermissions('member')}
      store={store}
      paste={paste}
      onSelectSystem={() => {}}
    />
  );
}

describe('selecting and removing signatures', () => {
  it('removes the selected rows with Delete and puts them back with Ctrl+Z', async () => {
    const removed: unknown[] = [];
    const restored: unknown[] = [];
    const a = signatureFixture('s1', SYSTEM, 'AAA-111', { createdAt: 2 });
    const b = signatureFixture('s2', SYSTEM, 'BBB-222', { createdAt: 1 });
    server.use(
      http.post(
        buildPath(routes.signatures.removeMany.path, { mapId: MAP_ID, solarSystemId: SYSTEM }),
        async ({ request }) => {
          removed.push(await request.json());
          return HttpResponse.json({ signatures: [a, b], connectionIds: [] });
        },
      ),
      http.post(buildPath(routes.signatures.restore.path, { mapId: MAP_ID }), async ({ request }) => {
        restored.push(await request.json());
        return HttpResponse.json([a, b]);
      }),
    );
    const user = userEvent.setup();
    render(<Section signatures={[a, b]} />);
    await user.click(screen.getByText('AAA-111'));
    await user.keyboard('{Control>}a{/Control}');
    expect(screen.getAllByRole('row', { selected: true })).toHaveLength(2);
    await user.keyboard('{Delete}');
    await waitFor(() =>
      expect(removed).toEqual([{ ids: ['s1', 's2'], withConnections: false, backLinks: true }]),
    );
    expect(await screen.findByRole('button', { name: /Undo/ })).toBeTruthy();
    expect(signatureUndoables(MAP_ID).map((u) => u.label)).toEqual(['2 signatures removed']);
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(restored).toEqual([{ signatures: [a, b] }]));
    expect(signatureUndoables(MAP_ID)).toEqual([]);
  });

  it('hands its removals to a shared undo stack, whose undo clears the bar too', async () => {
    const restored: unknown[] = [];
    const a = signatureFixture('s1', SYSTEM, 'AAA-111');
    server.use(
      http.post(buildPath(routes.signatures.removeMany.path, { mapId: MAP_ID, solarSystemId: SYSTEM }), () =>
        HttpResponse.json({ signatures: [a], connectionIds: [] }),
      ),
      http.post(buildPath(routes.signatures.restore.path, { mapId: MAP_ID }), async ({ request }) => {
        restored.push(await request.json());
        return HttpResponse.json([a]);
      }),
    );
    const changes = vi.fn();
    const unsubscribe = subscribeSignatureUndo(changes);
    const user = userEvent.setup();
    render(<Section signatures={[a]} />);
    await user.click(screen.getByText('AAA-111'));
    await user.keyboard('{Delete}');
    expect(await screen.findByRole('button', { name: /Undo/ })).toBeTruthy();
    expect(changes).toHaveBeenCalled();
    const [action] = signatureUndoables(MAP_ID);
    expect(action).toMatchObject({ mapId: MAP_ID, solarSystemId: SYSTEM, label: '1 signature removed' });
    expect(signatureUndoables('another-map')).toEqual([]);
    await act(async () => {
      expect(await action!.undo()).toEqual({ restored: 1, missed: 0 });
    });
    expect(restored).toEqual([{ signatures: [a] }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull());
    unsubscribe();
  });
});

describe('CommentsSection', () => {
  it('lists the thread and sends with Ctrl+Enter', async () => {
    const sent: unknown[] = [];
    server.use(
      http.get(buildPath(routes.comments.list.path, { mapId: MAP_ID, solarSystemId: SYSTEM }), () =>
        HttpResponse.json([
          {
            id: 'c1',
            mapId: MAP_ID,
            solarSystemId: SYSTEM,
            text: 'Keepstar **here**',
            author: { accountId: 'a', characterId: 90000001, name: 'Ayla Vex' },
            createdAt: Date.now(),
          },
        ]),
      ),
      http.post(
        buildPath(routes.comments.add.path, { mapId: MAP_ID, solarSystemId: SYSTEM }),
        async ({ request }) => {
          sent.push(await request.json());
          return HttpResponse.json({}, { status: 201 });
        },
      ),
    );
    const user = userEvent.setup();
    render(
      <CommentsSection
        mapId={MAP_ID}
        solarSystemId={SYSTEM}
        can={mapPermissions('member')}
        collapsed={false}
        onToggle={() => {}}
      />,
    );
    expect(await screen.findByText('Ayla Vex')).toBeTruthy();
    expect(screen.getByText('here').tagName).toBe('STRONG');
    await user.type(screen.getByRole('textbox', { name: 'New comment' }), 'Gone now');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sent).toEqual([{ text: 'Gone now' }]));
  });
});

describe('link signature after a jump', () => {
  it('offers the unlinked wormholes of the system you came from when your jump made a connection', async () => {
    setSignaturePrefs({ linkOnSplash: true });
    server.use(
      http.get(routes.accounts.me.path, () => HttpResponse.json(meFixture())),
      http.get(buildPath(routes.maps.getPreferences.path, { mapId: MAP_ID }), () =>
        HttpResponse.json({ viewport: null, bookmarkTemplate: null, bookmarkOrder: null, updatedAt: 0 }),
      ),
    );
    const me = meFixture().characters[0]!.id;
    const fresh = connectionFixture('c9', SYSTEM, HS);
    const sig = signatureFixture('s1', SYSTEM, 'ABC-123', { group: 'wormhole', type: 'D845' });
    const updateSignature = vi.fn(async () => true);
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(
      <TooltipProvider>
        <ToastProvider>
          <SignatureLayer
            mapId={MAP_ID}
            state={{
              map: null,
              systems: new Map([
                [SYSTEM, systemFixture(SYSTEM)],
                [HS, systemFixture(HS)],
              ]),
              connections: new Map([[fresh.id, fresh]]),
              signatures: new Map([[sig.id, sig]]),
            }}
            universe={universe}
            store={{ updateSignature, updateSystem: vi.fn(async () => true) }}
            canEdit
          />
        </ToastProvider>
      </TooltipProvider>,
      { realtime: fakeRealtime() },
    );
    const socket = FakeSocket.last!;
    act(() => socket.open());
    await waitFor(() => expect(queryClient.getQueryData(['me'])).toBeTruthy());
    const stream = `map:${MAP_ID}`;
    act(() =>
      socket.push(
        eventMessage(stream, 'character.jumped', { characterId: me, from: SYSTEM, to: HS, shipTypeId: null }),
      ),
    );
    act(() => socket.push(eventMessage(stream, 'connection.added', fresh)));
    expect(await screen.findByText('Which signature did you jump through?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /ABC-123/ }));
    expect(updateSignature).toHaveBeenCalledWith('s1', { connectionId: 'c9' });
  });
});

describe('what linking does for the system it leads to', () => {
  it('copies its bookmark label and fills temporary name, custom label and Label from templates', () => {
    const hole = connectionFixture('c1', SYSTEM, HS, { bookmarkNumber: 2, bookmarkParent: SYSTEM });
    const sig = signatureFixture('s1', SYSTEM, 'ABC-123', {
      group: 'wormhole',
      type: 'D845',
      connectionId: 'c1',
    });
    const map = {
      settings: { scopes: ['wormhole'], bookmarkNumbering: { order: 'found', renumberOnClose: false } },
      systemLabels: [
        { id: 'l1', name: 'WH1', description: '' },
        { id: 'l2', name: 'WH2', description: '' },
      ],
    } as unknown as MapDto;
    const changes = onLinkChanges(
      sig,
      {
        map,
        systems: new Map([
          [SYSTEM, systemFixture(SYSTEM, { status: 'home' })],
          [HS, systemFixture(HS)],
        ]),
        connections: new Map([[hole.id, hole]]),
        signatures: new Map([[sig.id, sig]]),
      },
      universe,
      {
        template: '{sig3} {destClass}',
        prefs: { copyLabel: true, tempName: '{sig3} out', customLabel: '{spawn}', label: 'WH{n}' },
      },
    );
    expect(changes).toEqual({
      target: HS,
      label: 'ABC out',
      patch: { temporaryName: 'ABC out', customLabel: 'Static', systemLabelIds: ['l2'] },
    });
  });
});
