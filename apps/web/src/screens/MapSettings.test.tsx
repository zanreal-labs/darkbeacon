// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { ReactFlowProvider } from '@xyflow/react';
import { useRouter } from 'next/navigation';
import type { MapDto, MapRole, MapSummaryDto } from '@darkbeacon/shared';
import { useMapSettings } from '../lib/useMapSettings';
import { mapsKey } from '../lib/session-keys';
import { MapSettingsRailButton } from '../shell/MapSettingsButton';
import { MAP_ID } from '../test/fixtures';
import { installFlowMocks, renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { MapSettingsDialog } from './MapSettings';
import { MapView } from './MapView';

// Nothing here needs the API's answers: lists stay empty, the account unknown.
const server = setupMockServer(http.get('*', () => new HttpResponse(null, { status: 404 })));
beforeAll(() => installFlowMocks());

const MAP: MapDto = {
  id: MAP_ID,
  slug: 'home-chain',
  name: 'Home chain',
  ownerAccountId: 'acc-1',
  settings: { scopes: ['wormhole'] },
  labels: [{ id: 'l1', name: 'Staging', color: '#38c6d6', description: '' }],
  systemLabels: [
    { id: 'wh1', name: 'WH1', description: '' },
    { id: 'wh2', name: 'WH2', description: '' },
  ],
  createdAt: 1,
  updatedAt: 1,
};
const summary = (role: MapSummaryDto['role']): MapSummaryDto[] => [
  { id: MAP.id, slug: MAP.slug, name: MAP.name, role },
];

let mounts = 0;
/** Stands in for the live map: counts how often it is mounted. */
function LiveMap() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <p>the live map</p>;
}

/** The map page as the app builds it: the rail button, the map, and the dialog while it is open. */
function Harness({ role }: { role: MapRole }) {
  const { section } = useMapSettings();
  return (
    <TooltipProvider>
      <ToastProvider>
        <nav aria-label="Main">
          <MapSettingsRailButton />
        </nav>
        <LiveMap />
        {section !== null && <MapSettingsDialog map={MAP} role={role} />}
      </ToastProvider>
    </TooltipProvider>
  );
}

function open(path: string, role: MapSummaryDto['role'] = 'admin') {
  window.history.replaceState(null, '', path);
  const view = renderWithProviders(<Harness role={role} />);
  act(() => void view.queryClient.setQueryData(mapsKey, summary(role)));
  return view;
}

afterEach(() => {
  mounts = 0;
  window.history.replaceState(null, '', '/');
});

describe('map settings dialog', () => {
  it('opens from the rail over the map without navigating', async () => {
    const user = userEvent.setup();
    const router = useRouter();
    vi.mocked(router.push).mockClear();
    vi.mocked(router.replace).mockClear();
    open('/m/home-chain');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Map settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Map settings' });
    expect(dialog).toHaveProperty('textContent', expect.stringContaining('Home chain'));
    expect(screen.getByRole('tab', { name: 'General', selected: true })).toBeTruthy();
    // Same page: only the query string changed, the router was never asked, the map stayed.
    expect(window.location.pathname).toBe('/m/home-chain');
    expect(window.location.search).toBe('?settings=general');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByText('the live map')).toBeTruthy();

    // Another section is another query string, still on the same page.
    await user.click(screen.getByRole('tab', { name: 'Labels' }));
    expect(window.location.search).toBe('?settings=labels');
    expect(screen.getByRole('heading', { name: 'Labels' })).toBeTruthy();

    // Escape closes it and drops the parameter; the map was mounted once all along.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/m/home-chain');
    expect(window.location.search).toBe('');
    expect(mounts).toBe(1);
  });

  it('closes with its close button', async () => {
    const user = userEvent.setup();
    open('/m/home-chain?settings=webhooks');
    const dialog = await screen.findByRole('dialog', { name: 'Map settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe('');
  });

  it('opens a deep link on its section', async () => {
    open('/m/home-chain?settings=tags');
    await screen.findByRole('dialog', { name: 'Map settings' });
    expect(screen.getByRole('tab', { name: 'Tags', selected: true })).toBeTruthy();
    expect(screen.getByRole('tabpanel')).toHaveProperty(
      'textContent',
      expect.stringContaining('Coloured markers for systems'),
    );
    expect((screen.getByRole('textbox', { name: 'Tag name' }) as HTMLInputElement).value).toBe('Staging');
    // The section's Save sits in the dialog's footer, tied to the section's form.
    const save = screen.getByRole('button', { name: 'Save tags' });
    expect(save.getAttribute('form')).toBe(screen.getByRole('form', { name: 'Tags' }).id);
  });

  it('keeps the Labels in order: add, rename, move and save them', async () => {
    const saved: unknown[] = [];
    const user = userEvent.setup();
    server.use(
      http.put(`/api/maps/${MAP_ID}/system-labels`, async ({ request }) => {
        const body = (await request.json()) as { systemLabels: unknown[] };
        saved.push(body);
        return HttpResponse.json(body.systemLabels);
      }),
    );
    open('/m/home-chain?settings=labels');
    await screen.findByRole('dialog', { name: 'Map settings' });
    const names = () =>
      screen.getAllByRole('textbox', { name: 'Label name' }).map((i) => (i as HTMLInputElement).value);
    expect(names()).toEqual(['WH1', 'WH2']);
    expect(screen.getByRole('button', { name: 'Save labels' })).toHaveProperty('disabled', true);

    // A new one is the next free WH number; names are at most 8 characters.
    await user.click(screen.getByRole('button', { name: 'Add label' }));
    expect(names()).toEqual(['WH1', 'WH2', 'WH3']);
    expect(screen.getAllByRole('textbox', { name: 'Label name' })[2]!.getAttribute('maxlength')).toBe('8');
    await user.clear(screen.getAllByRole('textbox', { name: 'Label name' })[2]!);
    await user.type(screen.getAllByRole('textbox', { name: 'Label name' })[2]!, 'A');
    await user.type(screen.getByRole('textbox', { name: 'Description of A' }), 'Anchor');
    await user.click(screen.getByRole('button', { name: 'Move A up' }));
    expect(names()).toEqual(['WH1', 'A', 'WH2']);
    await user.click(screen.getByRole('button', { name: 'Remove label WH1' }));
    await user.click(screen.getByRole('button', { name: 'Save labels' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      systemLabels: [
        { id: expect.any(String), name: 'A', description: 'Anchor' },
        { id: 'wh2', name: 'WH2', description: '' },
      ],
    });
  });

  it('shows managers only what they may change, and falls back to it', async () => {
    open('/m/home-chain?settings=general', 'manager');
    await screen.findByRole('dialog', { name: 'Map settings' });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Labels', 'Tags', 'Bookmark labels', 'Routes', 'Bridges']);
    expect(screen.getByRole('tab', { name: 'Labels', selected: true })).toBeTruthy();
  });

  it('has no rail button for members, nor off a map', async () => {
    open('/m/home-chain', 'member');
    expect(screen.queryByRole('button', { name: 'Map settings' })).toBeNull();
    window.history.replaceState(null, '', '/account');
    open('/account', 'admin');
    expect(screen.queryByRole('button', { name: 'Map settings' })).toBeNull();
  });
});

describe('the map', () => {
  it('has no settings button of its own', async () => {
    window.history.replaceState(null, '', '/m/home-chain');
    renderWithProviders(
      <TooltipProvider>
        <ToastProvider>
          <ReactFlowProvider>
            <MapView map={MAP} role="admin" />
          </ReactFlowProvider>
        </ToastProvider>
      </TooltipProvider>,
    );
    // The map rendered its top bar (the search), with nothing about settings next to it.
    await screen.findByRole('combobox', { name: 'Search systems to add' });
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
  });
});
